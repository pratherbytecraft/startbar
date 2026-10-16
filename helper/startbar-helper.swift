// Startbar helper. Compiled at install time by scripts/build-helper.js.
// Talks to the Electron side over stdin and stdout, one JSON line per message.
//
// Commands:
//   startbar-helper icons <cacheDir>
//     Reads app paths from stdin, one per line. Writes each app's icon as a
//     64 px PNG into cacheDir and prints {"path": ..., "png": ...} per app.
//
//   startbar-helper windows
//     Runs until stdin closes. Prints the running apps and their windows as
//     one {"type":"state"} line whenever something changes, at most four
//     times a second, and a {"type":"permission"} line at start and whenever
//     the Accessibility permission changes. Takes one JSON command per line
//     on stdin and answers each with a {"type":"reply"} line. See WindowWatcher.
//
//   startbar-helper screen-access
//     Prints {"allowed": true or false} for the Screen Recording permission
//     and exits. A fresh process sees a grant that a running one may not.
//
//   startbar-helper status
//     Runs until stdin closes. Prints the volume, Wi-Fi, battery and
//     Bluetooth for the tray, and where the Location, Bluetooth and
//     Automation permissions stand, as one {"type":"status"} line whenever
//     one changes, and takes commands to change them. Runs from its own small
//     app bundle so it can hold the Location permission. See StatusWatcher.
import AppKit
import ApplicationServices
import AudioToolbox
import CoreAudio
import CoreBluetooth
import CoreLocation
import CoreWLAN
import Foundation
import IOBluetooth
import IOKit
import IOKit.ps
import ScreenCaptureKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

func pngData(for image: NSImage, size: CGFloat) -> Data? {
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: rect, from: .zero, operation: .copy, fraction: 1.0)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

func cacheName(for path: String) -> String {
    // Stable file name per app path. djb2 keeps it short and dependency free.
    var hash: UInt64 = 5381
    for byte in path.utf8 { hash = (hash &* 33) &+ UInt64(byte) }
    let base = (path as NSString).lastPathComponent.replacingOccurrences(of: ".app", with: "")
    let safe = base.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map { String($0) }.joined()
    return "\(safe)-\(String(hash, radix: 16)).png"
}

func jsonText(_ object: Any) -> String? {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return nil }
    return String(data: data, encoding: .utf8)
}

func jsonLine(_ object: Any) {
    if let text = jsonText(object) {
        print(text)
        fflush(stdout)
    }
}

func runIcons(cacheDir: String) {
    try? FileManager.default.createDirectory(atPath: cacheDir, withIntermediateDirectories: true)
    while let line = readLine(strippingNewline: true) {
        let path = line.trimmingCharacters(in: .whitespaces)
        if path.isEmpty { continue }
        let out = (cacheDir as NSString).appendingPathComponent(cacheName(for: path))
        if !FileManager.default.fileExists(atPath: out) {
            // An .icns file is drawn as the image it holds, not as a file.
            let icon = (path.hasSuffix(".icns") ? NSImage(contentsOfFile: path) : nil) ?? NSWorkspace.shared.icon(forFile: path)
            icon.size = NSSize(width: 64, height: 64)
            if let data = pngData(for: icon, size: 64) {
                try? data.write(to: URL(fileURLWithPath: out))
            }
        }
        jsonLine(["path": path, "png": FileManager.default.fileExists(atPath: out) ? out : ""])
    }
}

// MARK: - Window list

// Private but long stable: the CGWindowID behind an Accessibility window.
// Every taskbar and window manager on macOS uses it. When it fails, the
// window is matched to the window server list by its owner and bounds.
// Builds an Accessibility element from a remote token: the app's pid and an
// element number. Used to reach windows on other Spaces, which the windows
// attribute leaves out. Private, the same call AltTab uses.
@_silgen_name("_AXUIElementCreateWithRemoteToken")
func _AXUIElementCreateWithRemoteToken(_ data: CFData) -> Unmanaged<AXUIElement>?

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowId: UnsafeMutablePointer<CGWindowID>) -> AXError

func axValue(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func axElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = axValue(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    (axValue(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func axBool(_ element: AXUIElement, _ name: String) -> Bool {
    (axValue(element, name) as? Bool) ?? false
}

func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let pos = axValue(element, kAXPositionAttribute), CFGetTypeID(pos) == AXValueGetTypeID(),
          let size = axValue(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var extent = CGSize.zero
    AXValueGetValue(pos as! AXValue, .cgPoint, &point)
    AXValueGetValue(size as! AXValue, .cgSize, &extent)
    return CGRect(origin: point, size: extent)
}

let axCallback: AXObserverCallback = { _, _, _, refcon in
    guard let refcon else { return }
    Unmanaged<WindowWatcher>.fromOpaque(refcon).takeUnretainedValue().changed()
}

// Out, one JSON object per line:
//   {"type":"permission","accessibility":true}
//   {"type":"state","apps":[{"pid","name","bundleId","path","active","hidden",
//     "windows":[{"id","order","title","minimized","focused","onScreen","fullScreen","otherSpace","x","y","w","h"}]}]}
//     Regular apps only. Windows are standard windows and dialogs, empty
//     without the permission. "order" counts up as windows are first seen,
//     "focused" is the app's own focused window, "onScreen" is false for
//     minimized windows, hidden apps and windows on other Spaces.
//     "otherSpace" marks windows on another Space, listed only after
//     {"cmd":"spaces","all":true}.
//   {"type":"reply","seq":n,"cmd":"...","ok":true} or with "error":"..."
// In, one JSON object per line, each with an optional "seq" echoed back:
//   {"cmd":"activate","id":"w123"}    raise the window and bring its app forward
//   {"cmd":"minimize","id":"w123"}    {"cmd":"unminimize","id":"w123"}
//   {"cmd":"close","id":"w123"}       press the window's close button
//   {"cmd":"askScreen"}               ask for the Screen Recording permission (macOS asks once)
//   {"cmd":"thumb","id":"w123","width":380,"height":240}
//                                     a picture of the window, answered later as "image", a JPEG data URL
//   {"cmd":"activateApp","pid":501}   {"cmd":"quitApp","pid":501}
//   {"cmd":"newWindow","pid":501}     bring the app forward and press Command N
//   {"cmd":"refresh"}                 send the state now, even if unchanged
//   {"cmd":"spaces","all":true}       also list windows on other Spaces
//   {"cmd":"keepOff","areas":[{"top":25,"bottom":830,"screen":{"x":0,"y":0,"w":1512,"h":866}}]}
//     one area per bar, or a single area's keys at the top level
//     move windows on that screen up when they would cover the bar, which
//     starts at "bottom". "top" is the bottom of the menu bar. Without
//     "bottom" it stops.
// STARTBAR_HELPER_DEBUG=1 prints scan and command timings to stderr.
final class WindowWatcher {
    struct Known {
        let element: AXUIElement
        let id: String
        let order: Int
    }

    var trusted = AXIsProcessTrusted()
    var observers: [pid_t: AXObserver] = [:]
    var known: [pid_t: [Known]] = [:]
    var lastWindows: [pid_t: [[String: Any]]] = [:]
    var busyUntil: [pid_t: Date] = [:]
    var busyCount: [pid_t: Int] = [:]
    var watchedWindows: [pid_t: [AXUIElement]] = [:]
    var counter = 0
    var lastLine = ""
    var keepOff: [(top: CGFloat, bottom: CGFloat, screen: CGRect)] = []
    var nudgeTried: [String: CGRect] = [:] // window id -> its frame after a move that didn't clear the bar
    var emitPending = false
    var allSpaces = false
    var replyExtra: [String: Any] = [:] // more fields for the reply to the command being run
    var desktopHid: [pid_t] = [] // apps hidden by Show Desktop, to bring back on the next click
    var desktopFront: pid_t? = nil // the app that was in front then
    var desktopMinimized: [AXUIElement] = [] // Finder windows minimized by Show Desktop
    var remote: [pid_t: [CGWindowID: AXUIElement]] = [:] // other Spaces' windows found by token
    var searched: [pid_t: Set<CGWindowID>] = [:] // window ids already looked for that way
    let debug = ProcessInfo.processInfo.environment["STARTBAR_HELPER_DEBUG"] != nil

    func note(_ text: String) {
        if debug { FileHandle.standardError.write((text + "\n").data(using: .utf8)!) }
    }

    static let appNotifications = [
        kAXWindowCreatedNotification, kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification,
        kAXApplicationHiddenNotification, kAXApplicationShownNotification
    ]
    static let windowNotifications = [
        kAXUIElementDestroyedNotification, kAXTitleChangedNotification, kAXWindowMiniaturizedNotification,
        kAXWindowDeminiaturizedNotification, kAXWindowMovedNotification, kAXWindowResizedNotification
    ]

    func start() {
        // Every Accessibility call gives up after half a second (the default
        // is six), so one busy app can't stall the bar.
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.5)
        jsonLine(["type": "permission", "accessibility": trusted])
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification,
                     NSWorkspace.didActivateApplicationNotification, NSWorkspace.didHideApplicationNotification,
                     NSWorkspace.didUnhideApplicationNotification, NSWorkspace.activeSpaceDidChangeNotification] {
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.changed() }
        }
        // The slow poll catches apps that don't send notifications, and a
        // permission granted or taken away in System Settings.
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            let now = AXIsProcessTrusted()
            if now != self.trusted {
                self.trusted = now
                if !now { self.dropObservers() }
                jsonLine(["type": "permission", "accessibility": now])
            }
            self.changed()
        }
        emitState()
        readCommands()
    }

    // Coalesces bursts (a window being dragged sends dozens of moves) into
    // at most one scan every quarter second.
    func changed() {
        if emitPending { return }
        emitPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self else { return }
            self.emitPending = false
            self.emitState()
        }
    }

    func emitState() {
        let started = Date()
        let apps = scan()
        note(String(format: "scan %.0f ms", Date().timeIntervalSince(started) * 1000))
        guard let line = jsonText(["type": "state", "apps": apps]), line != lastLine else { return }
        lastLine = line
        print(line)
        fflush(stdout)
    }

    // Apps that get a button: regular apps, minus Startbar itself (it can
    // show up as regular while one of its windows is focused).
    func regularApps() -> [NSRunningApplication] {
        let parent = getppid()
        return NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && !$0.isTerminated && $0.processIdentifier != parent
                && $0.bundleIdentifier != "com.pratherbytecraft.startbar"
        }
    }

    // Window server view: which windows are on screen right now (current
    // Space, not minimized, app not hidden) and every window's owner and
    // bounds for the fallback match. No titles, so no Screen Recording.
    func windowServerList() -> (onScreen: Set<CGWindowID>, all: [(pid: pid_t, id: CGWindowID, bounds: CGRect)]) {
        var onScreen = Set<CGWindowID>()
        var all: [(pid_t, CGWindowID, CGRect)] = []
        if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            for info in list { if let id = info[kCGWindowNumber as String] as? CGWindowID { onScreen.insert(id) } }
        }
        if let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
            for info in list {
                guard (info[kCGWindowLayer as String] as? Int) == 0,
                      let id = info[kCGWindowNumber as String] as? CGWindowID,
                      let pid = info[kCGWindowOwnerPID as String] as? pid_t,
                      let dict = info[kCGWindowBounds as String] as? NSDictionary,
                      let bounds = CGRect(dictionaryRepresentation: dict) else { continue }
                all.append((pid, id, bounds))
            }
        }
        return (onScreen, all)
    }

    func scan() -> [[String: Any]] {
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let server = trusted ? windowServerList() : (onScreen: Set<CGWindowID>(), all: [])
        var out: [[String: Any]] = []
        var alive = Set<pid_t>()
        for app in regularApps() {
            let pid = app.processIdentifier
            alive.insert(pid)
            var entry: [String: Any] = [
                "pid": Int(pid),
                "name": app.localizedName ?? "",
                "bundleId": app.bundleIdentifier ?? "",
                "path": app.bundleURL?.path ?? "",
                "active": pid == front,
                "hidden": app.isHidden,
                "windows": [[String: Any]]()
            ]
            // An app that is still launching can't answer yet, and asking too
            // early leaves it timing out for a while after.
            if trusted && app.isFinishedLaunching { entry["windows"] = windows(of: pid, server: server) }
            out.append(entry)
        }
        for pid in Array(known.keys) where !alive.contains(pid) {
            known[pid] = nil
            remote[pid] = nil
            searched[pid] = nil
            lastWindows[pid] = nil
            busyUntil[pid] = nil
            busyCount[pid] = nil
        }
        for pid in Array(observers.keys) where !alive.contains(pid) { removeObserver(pid) }
        return out
    }

    func windows(of pid: pid_t, server: (onScreen: Set<CGWindowID>, all: [(pid: pid_t, id: CGWindowID, bounds: CGRect)])) -> [[String: Any]] {
        if let until = busyUntil[pid], until > Date() { return lastWindows[pid] ?? [] }
        let appElement = AXUIElementCreateApplication(pid)
        // Busy apps (Finder often) sometimes fail the call instead of
        // answering. Keep the last good answer then, so buttons don't flicker.
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &value)
        if result == .noValue { return [] }
        guard result == .success, let list = value as? [AXUIElement] else {
            note("pid \(pid) window list failed (\(result.rawValue)), keeping its last one")
            return backOff(pid)
        }
        // Observers go on only once the app answers. Added while it is still
        // launching, they leave the app timing out on every later call.
        addObserver(pid, appElement)
        let focused = axElement(appElement, kAXFocusedWindowAttribute)
        let before = known[pid] ?? []
        var after: [Known] = []
        var out: [[String: Any]] = []
        let elsewhere = allSpaces ? otherSpaceWindows(pid, listed: list, server: server) : [:]
        for window in list + Array(elsewhere.values) {
            var subroleValue: CFTypeRef?
            let subroleResult = AXUIElementCopyAttributeValue(window, kAXSubroleAttribute as CFString, &subroleValue)
            // One timeout means the app is busy. Skip it this round rather
            // than wait half a second on each of its windows.
            if subroleResult == .cannotComplete {
                note("pid \(pid) busy, keeping its last window list")
                return backOff(pid)
            }
            let subrole = subroleValue as? String
            guard subrole == kAXStandardWindowSubrole || subrole == kAXDialogSubrole else { continue }
            let frame = axFrame(window)
            var windowId: CGWindowID = 0
            if _AXUIElementGetWindow(window, &windowId) != .success || windowId == 0, let frame {
                windowId = server.all.first { $0.pid == pid && $0.bounds == frame }?.id ?? 0
            }
            // A window seen before keeps its place, even when it comes back as
            // a different element (listed now, found by token before).
            let item: Known
            if let seen = before.first(where: { CFEqual($0.element, window) }) {
                item = seen
            } else if windowId != 0, let seen = before.first(where: { $0.id == "w\(windowId)" }) {
                item = Known(element: window, id: seen.id, order: seen.order)
                watch(window, pid: pid)
            } else {
                counter += 1
                item = Known(element: window, id: windowId != 0 ? "w\(windowId)" : "p\(pid)-\(counter)", order: counter)
                watch(window, pid: pid)
            }
            after.append(item)
            let onScreen = windowId != 0 && server.onScreen.contains(windowId)
            if onScreen, let frame { nudge(window, id: item.id, frame: frame) }
            out.append([
                "id": item.id,
                "order": item.order,
                "title": axValue(window, kAXTitleAttribute) as? String ?? "",
                "minimized": axBool(window, kAXMinimizedAttribute),
                "focused": focused.map { CFEqual($0, window) } ?? false,
                "onScreen": onScreen,
                "fullScreen": axBool(window, "AXFullScreen"),
                "otherSpace": elsewhere[windowId].map { CFEqual($0, window) } ?? false,
                "x": Int(frame?.origin.x ?? 0), "y": Int(frame?.origin.y ?? 0),
                "w": Int(frame?.size.width ?? 0), "h": Int(frame?.size.height ?? 0)
            ])
        }
        known[pid] = after
        lastWindows[pid] = out
        busyUntil[pid] = nil
        busyCount[pid] = nil
        return out
    }

    // Keeps a window off the bar. macOS has no way to reserve the space, so
    // a window whose bottom edge sits under the bar is moved up to end at
    // the bar, and one too tall for the space between the menu bar and the
    // bar is moved to the top and shortened. Leaves alone full screen
    // windows, windows taller than the screen, windows parked partly below
    // the screen, and anything while a mouse button is down (a drag). A
    // window that refused to move isn't tried again until its frame changes.
    func nudge(_ window: AXUIElement, id: String, frame: CGRect) {
        // The bar on the display the window's top edge is on.
        guard NSEvent.pressedMouseButtons == 0,
              let k = keepOff.first(where: { $0.screen.contains(CGPoint(x: frame.midX, y: frame.minY)) }) else { return }
        guard frame.maxY > k.bottom + 1, frame.maxY <= k.screen.maxY + 1,
              frame.height <= k.screen.height else { return }
        if nudgeTried[id] == frame { return }
        if axBool(window, "AXFullScreen") { return }
        var target = CGRect(x: frame.minX, y: k.bottom - frame.height, width: frame.width, height: frame.height)
        if target.minY < k.top {
            target.origin.y = k.top
            target.size.height = k.bottom - k.top
        }
        var origin = target.origin
        if let value = AXValueCreate(.cgPoint, &origin) {
            AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, value)
        }
        if target.height != frame.height {
            var size = target.size
            if let value = AXValueCreate(.cgSize, &size) {
                AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, value)
            }
        }
        let now = axFrame(window) ?? frame
        nudgeTried[id] = now.maxY > k.bottom + 1 ? now : nil
        note("moved \(id) from \(frame) to \(now)")
    }

    // A slow app (one just launched, or beachballing) is left alone for a
    // growing pause, half a second up to four, so it can't slow the scan
    // for every other app. Its last good answer stands in meanwhile.
    func backOff(_ pid: pid_t) -> [[String: Any]] {
        let count = (busyCount[pid] ?? 0) + 1
        busyCount[pid] = count
        busyUntil[pid] = Date().addingTimeInterval(min(4.0, 0.25 * pow(2.0, Double(count))))
        return lastWindows[pid] ?? []
    }

    // MARK: Observers

    func addObserver(_ pid: pid_t, _ appElement: AXUIElement) {
        if observers[pid] != nil { return }
        var observer: AXObserver?
        guard AXObserverCreate(pid, axCallback, &observer) == .success, let observer else { return }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for name in WindowWatcher.appNotifications {
            AXObserverAddNotification(observer, appElement, name as CFString, refcon)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        observers[pid] = observer
    }

    // Windows of this app on other Spaces, by window id. The window server
    // knows every window; the ones the windows attribute leaves out are
    // looked for once by trying element numbers, like AltTab. Ids that turn
    // out not to be windows (an app's hidden helper windows) aren't tried again.
    func otherSpaceWindows(_ pid: pid_t, listed: [AXUIElement],
                           server: (onScreen: Set<CGWindowID>, all: [(pid: pid_t, id: CGWindowID, bounds: CGRect)])) -> [CGWindowID: AXUIElement] {
        var listedIds = Set<CGWindowID>()
        for window in listed {
            var id: CGWindowID = 0
            if _AXUIElementGetWindow(window, &id) == .success { listedIds.insert(id) }
        }
        let candidates = server.all.filter {
            $0.pid == pid && !listedIds.contains($0.id) && !server.onScreen.contains($0.id)
                && $0.bounds.width >= 50 && $0.bounds.height >= 50
        }.map(\.id)
        let alive = Set(candidates)
        var found = (remote[pid] ?? [:]).filter { alive.contains($0.key) }
        let fresh = candidates.filter { found[$0] == nil && !(searched[pid] ?? []).contains($0) }
        if !fresh.isEmpty {
            let started = Date()
            var token = Data(count: 20)
            token.replaceSubrange(0..<4, with: withUnsafeBytes(of: pid) { Data($0) })
            token.replaceSubrange(8..<12, with: withUnsafeBytes(of: Int32(0x636f636f)) { Data($0) })
            for number in UInt64(0)..<1000 {
                token.replaceSubrange(12..<20, with: withUnsafeBytes(of: number) { Data($0) })
                guard let element = _AXUIElementCreateWithRemoteToken(token as CFData)?.takeRetainedValue() else { continue }
                var id: CGWindowID = 0
                guard _AXUIElementGetWindow(element, &id) == .success, alive.contains(id), found[id] == nil else { continue }
                let subrole = axValue(element, kAXSubroleAttribute) as? String
                guard subrole == kAXStandardWindowSubrole || subrole == kAXDialogSubrole else { continue }
                found[id] = element
            }
            searched[pid, default: []].formUnion(fresh)
            note(String(format: "pid %d other Spaces search %.0f ms, %d found", pid, Date().timeIntervalSince(started) * 1000, found.count))
        }
        searched[pid] = (searched[pid] ?? []).intersection(alive)
        remote[pid] = found
        return found
    }

    func watch(_ window: AXUIElement, pid: pid_t) {
        guard let observer = observers[pid] else { return }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for name in WindowWatcher.windowNotifications {
            AXObserverAddNotification(observer, window, name as CFString, refcon)
        }
    }

    func removeObserver(_ pid: pid_t) {
        if let observer = observers.removeValue(forKey: pid) {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        }
    }

    func dropObservers() {
        for pid in Array(observers.keys) { removeObserver(pid) }
        known.removeAll()
        lastWindows.removeAll()
    }

    // MARK: Commands

    func readCommands() {
        Thread.detachNewThread {
            while let line = readLine(strippingNewline: true) {
                DispatchQueue.main.async { self.handle(line) }
            }
            // Startbar closed our stdin or quit. Nothing left to do.
            DispatchQueue.main.async { exit(0) }
        }
    }

    func find(_ id: String) -> (pid: pid_t, element: AXUIElement)? {
        for (pid, list) in known {
            if let item = list.first(where: { $0.id == id }) { return (pid, item.element) }
        }
        return nil
    }

    func handle(_ line: String) {
        let started = Date()
        defer { note(String(format: "command %.0f ms: %@", Date().timeIntervalSince(started) * 1000, line)) }
        guard let data = line.data(using: .utf8),
              let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let name = command["cmd"] as? String else {
            jsonLine(["type": "reply", "ok": false, "error": "not a command"])
            return
        }
        var reply: [String: Any] = ["type": "reply", "cmd": name]
        if let seq = command["seq"] { reply["seq"] = seq }
        if name == "thumb" { return thumb(command, reply) }
        replyExtra = [:]
        let error = run(name, command)
        reply.merge(replyExtra) { _, extra in extra }
        reply["ok"] = error == nil
        if let error { reply["error"] = error }
        jsonLine(reply)
        changed()
    }

    // Returns nil on success, or what went wrong in a few words.
    func run(_ name: String, _ command: [String: Any]) -> String? {
        switch name {
        case "refresh":
            lastLine = ""
            emitState()
            return nil
        case "spaces":
            allSpaces = command["all"] as? Bool ?? false
            if !allSpaces {
                remote.removeAll()
                searched.removeAll()
            }
            lastLine = ""
            return nil
        case "keepOff":
            nudgeTried.removeAll()
            keepOff = []
            let areas = command["areas"] as? [[String: Any]] ?? [command]
            for area in areas {
                guard let bottom = area["bottom"] as? Double, let top = area["top"] as? Double,
                      let screen = area["screen"] as? [String: Double],
                      let x = screen["x"], let y = screen["y"], let w = screen["w"], let h = screen["h"] else { continue }
                keepOff.append((CGFloat(top), CGFloat(bottom), CGRect(x: x, y: y, width: w, height: h)))
            }
            return nil
        case "showDesktop":
            showDesktop()
            return nil
        case "askScreen":
            CGRequestScreenCaptureAccess()
            return nil
        case "activateApp", "quitApp", "newWindow":
            guard let pid = command["pid"] as? Int, let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
                return "no such app"
            }
            if name == "quitApp" { return app.terminate() ? nil : "the app did not quit" }
            activateApp(app)
            if name == "newWindow" {
                guard trusted else { return "no accessibility permission" }
                if let found = newWindowItem(pid_t(pid)) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        AXUIElementPerformAction(found.item, kAXPressAction as CFString)
                    }
                } else {
                    newWindow(pid_t(pid))
                }
            }
            return nil
        case "newWindowItem":
            guard trusted else { return "no accessibility permission" }
            guard let pid = command["pid"] as? Int, let found = newWindowItem(pid_t(pid)) else { return "no new window item" }
            replyExtra["title"] = found.title
            return nil
        case "activate", "minimize", "unminimize", "close":
            guard trusted else { return "no accessibility permission" }
            guard let id = command["id"] as? String, let (pid, window) = find(id) else { return "no such window" }
            switch name {
            case "activate":
                activate(window, pid: pid)
                return nil
            case "minimize":
                return AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success
                    ? nil : "the window did not minimize"
            case "unminimize":
                return AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success
                    ? nil : "the window did not come back"
            default:
                guard let button = axElement(window, kAXCloseButtonAttribute) else { return "the window has no close button" }
                return AXUIElementPerformAction(button, kAXPressAction as CFString) == .success ? nil : "the window did not close"
            }
        default:
            return "unknown command"
        }
    }

    // A picture of one window for the hover preview, fit inside width by
    // height points (at twice that in pixels), through ScreenCaptureKit. The
    // reply comes when the picture is ready. Needs Screen Recording.
    func thumb(_ command: [String: Any], _ base: [String: Any]) {
        var reply = base
        func send(_ error: String?, _ image: String? = nil) {
            reply["ok"] = error == nil
            if let error { reply["error"] = error }
            if let image { reply["image"] = image }
            DispatchQueue.main.async { jsonLine(reply) }
        }
        guard let id = command["id"] as? String, id.hasPrefix("w"), let number = UInt32(id.dropFirst()) else { return send("no window number") }
        guard #available(macOS 14.0, *) else { return send("needs macOS 14") }
        let maxW = command["width"] as? Double ?? 380
        let maxH = command["height"] as? Double ?? 240
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, error in
            guard let content else { return send(error?.localizedDescription ?? "no screen access") }
            guard let window = content.windows.first(where: { $0.windowID == number }), window.frame.width > 0, window.frame.height > 0 else {
                return send("no such window")
            }
            let scale = min(maxW / window.frame.width, maxH / window.frame.height, 1) * 2
            let config = SCStreamConfiguration()
            config.width = max(1, Int(window.frame.width * scale))
            config.height = max(1, Int(window.frame.height * scale))
            config.showsCursor = false
            SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config) { image, error in
                guard let image, let data = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
                    return send(error?.localizedDescription ?? "no picture")
                }
                send(nil, "data:image/jpeg;base64," + data.base64EncodedString())
            }
        }
    }

    // Hides every app but Startbar, and brings back the same ones on the next
    // click. Showing one of them by hand in between starts over. Finder's
    // windows are minimized instead, since macOS brings Finder forward (and
    // unhides it) when everything else is hidden. Hiding and unhiding go
    // through Accessibility: from a background process NSRunningApplication's
    // unhide doesn't take, and hide reports false even when it works.
    func showDesktop() {
        let hid = desktopHid.compactMap { NSRunningApplication(processIdentifier: $0) }
        if !(hid.isEmpty && desktopMinimized.isEmpty) && hid.allSatisfy({ $0.isHidden }) {
            for app in hid {
                if !trusted || AXUIElementSetAttributeValue(AXUIElementCreateApplication(app.processIdentifier), kAXHiddenAttribute as CFString, kCFBooleanFalse) != .success {
                    app.unhide()
                }
            }
            for window in desktopMinimized { AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse) }
            if let pid = desktopFront, let front = NSRunningApplication(processIdentifier: pid) { activateApp(front) }
            desktopHid = []
            desktopMinimized = []
            desktopFront = nil
            return
        }
        // Startbar itself can be in front (after its settings window); opening
        // it again on the way back would open the Start menu.
        let front = NSWorkspace.shared.frontmostApplication
        let frontIsUs = front?.processIdentifier == getppid() || (front?.bundleIdentifier ?? "").hasPrefix("com.pratherbytecraft.startbar")
        desktopFront = frontIsUs ? nil : front?.processIdentifier
        desktopHid = []
        desktopMinimized = []
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular && !app.isHidden {
            let id = app.bundleIdentifier ?? ""
            if app.processIdentifier == getppid() || id.hasPrefix("com.pratherbytecraft.startbar") { continue }
            if id == "com.apple.finder" {
                guard trusted else { continue }
                var value: CFTypeRef?
                AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier), kAXWindowsAttribute as CFString, &value)
                for window in value as? [AXUIElement] ?? [] {
                    var minimized: CFTypeRef?
                    AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute as CFString, &minimized)
                    if (minimized as? Bool) == true { continue }
                    if AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success {
                        desktopMinimized.append(window)
                    }
                }
            } else {
                if !trusted || AXUIElementSetAttributeValue(AXUIElementCreateApplication(app.processIdentifier), kAXHiddenAttribute as CFString, kCFBooleanTrue) != .success {
                    app.hide()
                }
                desktopHid.append(app.processIdentifier)
            }
        }
    }

    // Like clicking the app in the Dock. Launch Services is allowed to bring
    // an app forward from a background process, NSRunningApplication isn't
    // always on macOS 14 and later.
    func activateApp(_ app: NSRunningApplication) {
        if app.isHidden { app.unhide() }
        if let url = app.bundleURL {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in }
        } else {
            app.activate(options: [])
        }
    }

    // The app's own New Window menu item (Safari's New Window, Finder's New
    // Finder Window, Terminal's under Shell), leaving out private and
    // incognito ones. An item with a submenu (Terminal's profiles) gives the
    // first item in it.
    func newWindowItem(_ pid: pid_t) -> (title: String, item: AXUIElement)? {
        guard let bar = axElement(AXUIElementCreateApplication(pid), kAXMenuBarAttribute) else { return nil }
        for top in axChildren(bar).dropFirst() { // past the Apple menu
            for menu in axChildren(top) {
                for item in axChildren(menu) {
                    guard let title = axValue(item, kAXTitleAttribute) as? String else { continue }
                    let lower = title.lowercased()
                    guard lower.hasPrefix("new"), lower.contains("window"),
                          !lower.contains("private"), !lower.contains("incognito"),
                          axBool(item, kAXEnabledAttribute) else { continue }
                    if let sub = axChildren(item).first {
                        guard let first = axChildren(sub).first(where: { axBool($0, kAXEnabledAttribute) }) else { continue }
                        return (title, first)
                    }
                    return (title, item)
                }
            }
        }
        return nil
    }

    // Command N, for apps without a New Window menu item, sent straight to
    // the app so it lands even if another app is still in front. Waits a
    // moment for the app to come forward first.
    func newWindow(_ pid: pid_t) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            let source = CGEventSource(stateID: .hidSystemState)
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: source, virtualKey: 45, keyDown: down) // N
                event?.flags = .maskCommand
                event?.postToPid(pid)
            }
        }
    }

    func activate(_ window: AXUIElement, pid: pid_t) {
        let app = NSRunningApplication(processIdentifier: pid)
        if app?.isHidden == true { app?.unhide() }
        if axBool(window, kAXMinimizedAttribute) {
            AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        }
        let appElement = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        AXUIElementSetAttributeValue(appElement, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        // Bringing the app forward can raise its last used window over ours.
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }
}

// MARK: - Tray status

// Out:
//   {"type":"status","volume":{"level":0.5,"muted":false,"settable":true} or null,
//    "wifi":{"on":true,"connected":true,"bars":3} or null,
//    "battery":{"percent":80,"charging":true,"plugged":true,"minutes":95} or null}
//   null means the Mac has no such thing (no output device, no Wi-Fi, no battery).
//   minutes is the time to empty, or to full while charging, or -1 when unknown.
//   The Wi-Fi network name isn't included: macOS only gives it out with the
//   Location permission, which Startbar doesn't ask for.
// In, each with an optional "seq" echoed in a {"type":"reply"} line:
//   {"cmd":"setVolume","level":0.4}   {"cmd":"setMuted","muted":true}
//   {"cmd":"setWifi","on":false}      {"cmd":"refresh"}
final class StatusWatcher: NSObject, CWEventDelegate, CLLocationManagerDelegate, CBCentralManagerDelegate {
    var lastLine = ""
    var pending = false
    var device = AudioObjectID(kAudioObjectUnknown)
    let wifiClient = CWWiFiClient.shared()
    var location: CLLocationManager!
    var central: CBCentralManager? // made once Bluetooth is allowed, making it asks
    var connectNote: IOBluetoothUserNotification?
    var access: [String: String] = [:]

    func start() {
        watchDefaultDevice()
        watchDevice()
        wifiClient.delegate = self
        for event in [CWEventType.powerDidChange, .linkDidChange, .linkQualityDidChange, .ssidDidChange] {
            try? wifiClient.startMonitoringEvent(with: event)
        }
        location = CLLocationManager()
        location.delegate = self
        if CBManager.authorization == .allowedAlways { startBluetooth() }
        checkAccess()
        if let source = IOPSNotificationCreateRunLoopSource({ _ in statusWatcher?.changed() }, nil)?.takeRetainedValue() {
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
        }
        // Signal strength and battery time drift without events. A slow poll
        // catches them; the line is only printed when something changed.
        Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.emit() }
        readCommands()
        emit()
    }

    func changed() {
        guard !pending else { return }
        pending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.pending = false
            self.emit()
        }
    }

    func emit() {
        var out: [String: Any] = ["type": "status"]
        out["volume"] = volume() ?? NSNull()
        out["wifi"] = wifi() ?? NSNull()
        out["battery"] = battery() ?? NSNull()
        out["bluetooth"] = bluetooth() ?? NSNull()
        out["access"] = access
        guard let line = jsonText(out), line != lastLine else { return }
        lastLine = line
        print(line)
        fflush(stdout)
    }

    // MARK: Volume

    func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeOutput) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    func defaultDevice() -> AudioObjectID {
        var id = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var addr = address(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
        return id
    }

    func watchDefaultDevice() {
        var addr = address(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal)
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, DispatchQueue.main) { [weak self] _, _ in
            self?.watchDevice()
            self?.changed()
        }
    }

    // Listens to the current output device's volume and mute. A new default
    // device gets its own listeners; the old device's stay but only nudge a
    // redraw that finds nothing changed.
    func watchDevice() {
        device = defaultDevice()
        guard device != kAudioObjectUnknown else { return }
        for selector in [kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioDevicePropertyMute] {
            var addr = address(selector)
            AudioObjectAddPropertyListenerBlock(device, &addr, DispatchQueue.main) { [weak self] _, _ in self?.changed() }
        }
    }

    func volume() -> [String: Any]? {
        guard device != kAudioObjectUnknown else { return nil }
        var level = Float32(0)
        var size = UInt32(MemoryLayout<Float32>.size)
        var addr = address(kAudioHardwareServiceDeviceProperty_VirtualMainVolume)
        guard AudioObjectHasProperty(device, &addr),
              AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &level) == noErr else {
            return ["level": 1, "muted": false, "settable": false]
        }
        var settable = DarwinBoolean(false)
        AudioObjectIsPropertySettable(device, &addr, &settable)
        var muted = UInt32(0)
        size = UInt32(MemoryLayout<UInt32>.size)
        var muteAddr = address(kAudioDevicePropertyMute)
        if AudioObjectHasProperty(device, &muteAddr) {
            AudioObjectGetPropertyData(device, &muteAddr, 0, nil, &size, &muted)
        }
        return ["level": (Double(level) * 100).rounded() / 100, "muted": muted != 0, "settable": settable.boolValue]
    }

    func setVolume(_ level: Double) -> String? {
        var value = Float32(max(0, min(1, level)))
        var addr = address(kAudioHardwareServiceDeviceProperty_VirtualMainVolume)
        let size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectSetPropertyData(device, &addr, 0, nil, size, &value) == noErr else { return "the volume can't be changed" }
        // Turning the volume up from muted unmutes, like the volume keys do.
        if value > 0 { _ = setMuted(false) }
        return nil
    }

    func setMuted(_ muted: Bool) -> String? {
        var value = UInt32(muted ? 1 : 0)
        var addr = address(kAudioDevicePropertyMute)
        let size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectHasProperty(device, &addr),
              AudioObjectSetPropertyData(device, &addr, 0, nil, size, &value) == noErr else { return "this output can't be muted" }
        return nil
    }

    // MARK: Wi-Fi

    func wifi() -> [String: Any]? {
        guard let iface = wifiClient.interface() else { return nil }
        let on = iface.powerOn()
        let rssi = iface.rssiValue()
        let connected = on && rssi != 0
        // Rough bars from the signal, the way the menu bar draws them.
        let bars = !connected ? 0 : rssi >= -60 ? 3 : rssi >= -70 ? 2 : 1
        var out: [String: Any] = ["on": on, "connected": connected, "bars": bars]
        // macOS hands out the network's name only with the Location permission.
        if connected, access["location"] == "allowed", let name = iface.ssid(), !name.isEmpty { out["name"] = name }
        return out
    }

    func setWifi(_ on: Bool) -> String? {
        guard let iface = wifiClient.interface() else { return "this Mac has no Wi-Fi" }
        do {
            try iface.setPower(on)
            return nil
        } catch {
            return "Wi-Fi didn't change"
        }
    }

    func powerStateDidChangeForWiFiInterface(withName interfaceName: String) { changed() }
    func linkDidChangeForWiFiInterface(withName interfaceName: String) { changed() }
    func linkQualityDidChangeForWiFiInterface(withName interfaceName: String, rssi: Int, transmitRate: Double) { changed() }
    func ssidDidChangeForWiFiInterface(withName interfaceName: String) { changed() }

    // MARK: Battery

    func battery() -> [String: Any]? {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
        for source in list {
            guard let desc = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
                  desc[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
                  desc[kIOPSIsPresentKey] as? Bool != false else { continue }
            let current = desc[kIOPSCurrentCapacityKey] as? Int ?? 0
            let max = desc[kIOPSMaxCapacityKey] as? Int ?? 100
            let charging = desc[kIOPSIsChargingKey] as? Bool ?? false
            let plugged = desc[kIOPSPowerSourceStateKey] as? String == kIOPSACPowerValue
            let minutes = (charging ? desc[kIOPSTimeToFullChargeKey] : desc[kIOPSTimeToEmptyKey]) as? Int ?? -1
            let percent = max > 0 ? Int((Double(current) / Double(max) * 100).rounded()) : current
            return ["percent": percent, "charging": charging, "plugged": plugged, "minutes": minutes]
        }
        return nil
    }

    // MARK: Bluetooth

    // Nothing here touches Bluetooth until macOS says Startbar may, or the
    // process is stopped on the spot. The permission belongs to Startbar.app,
    // which started this helper.
    func startBluetooth() {
        guard central == nil else { return }
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        checkAccess()
        if CBManager.authorization == .allowedAlways && connectNote == nil {
            // Fires for the devices already connected too.
            connectNote = IOBluetoothDevice.register(forConnectNotifications: self, selector: #selector(deviceConnected(_:device:)))
        }
        changed()
    }

    @objc func deviceConnected(_ note: IOBluetoothUserNotification, device: IOBluetoothDevice) {
        device.register(forDisconnectNotification: self, selector: #selector(deviceDisconnected(_:device:)))
        changed()
    }

    @objc func deviceDisconnected(_ note: IOBluetoothUserNotification, device: IOBluetoothDevice) {
        note.unregister()
        changed()
    }

    // nil until allowed, and on a Mac without Bluetooth.
    func bluetooth() -> [String: Any]? {
        guard let c = central, CBManager.authorization == .allowedAlways,
              c.state == .poweredOn || c.state == .poweredOff else { return nil }
        let on = c.state == .poweredOn
        let batteries = bluetoothBatteries()
        let paired = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice]) ?? []
        let devices: [[String: Any]] = paired.map { d in
            var out: [String: Any] = [
                "address": d.addressString ?? "",
                "name": d.nameOrAddress ?? "Device",
                "connected": on && d.isConnected(),
                "kind": deviceKind(d)
            ]
            if let percent = batteries[plainAddress(d.addressString)] { out["battery"] = percent }
            return out
        }
        return ["on": on, "devices": devices]
    }

    func deviceKind(_ d: IOBluetoothDevice) -> String {
        switch d.deviceClassMajor {
        case 0x01: return "computer"
        case 0x02: return "phone"
        case 0x04: return "audio"
        case 0x05: // peripheral, keyboard and pointing bits in the minor class
            if d.deviceClassMinor & 0x10 != 0 { return "keyboard" }
            if d.deviceClassMinor & 0x20 != 0 { return "mouse" }
            return "other"
        default: return "other"
        }
    }

    func plainAddress(_ address: String?) -> String {
        (address ?? "").lowercased().filter { $0.isHexDigit }
    }

    // Apple keyboards, mice and trackpads report their charge in the I/O
    // registry. Other devices don't share theirs.
    func bluetoothBatteries() -> [String: Int] {
        var out: [String: Int] = [:]
        var iter = io_iterator_t()
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleDeviceManagementHIDEventService"), &iter) == KERN_SUCCESS else { return out }
        defer { IOObjectRelease(iter) }
        var service = IOIteratorNext(iter)
        while service != 0 {
            let percent = IORegistryEntryCreateCFProperty(service, "BatteryPercent" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? Int
            let address = IORegistryEntryCreateCFProperty(service, "DeviceAddress" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String
            if let percent, let address { out[plainAddress(address)] = percent }
            IOObjectRelease(service)
            service = IOIteratorNext(iter)
        }
        return out
    }

    // The same switch as the one in Control Center. IOBluetooth has it but
    // doesn't publish it.
    func setBluetooth(_ on: Bool) -> String? {
        guard central != nil, CBManager.authorization == .allowedAlways else { return "Bluetooth isn't allowed" }
        typealias SetPower = @convention(c) (Int32) -> Int32
        guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "IOBluetoothPreferenceSetControllerPowerState") else {
            return "Bluetooth can't be switched from here"
        }
        _ = unsafeBitCast(sym, to: SetPower.self)(on ? 1 : 0)
        return nil
    }

    // Connecting can take a few seconds, so it runs off the main thread.
    func setConnected(_ address: String, _ on: Bool) -> String? {
        guard central != nil, CBManager.authorization == .allowedAlways else { return "Bluetooth isn't allowed" }
        guard let d = IOBluetoothDevice(addressString: address) else { return "that device wasn't found" }
        DispatchQueue.global().async {
            _ = on ? d.openConnection() : d.closeConnection()
            DispatchQueue.main.async { self.changed() }
        }
        return nil
    }

    // MARK: Permissions

    // Where each permission stands: allowed, notAsked or denied. Location is
    // off when Location Services is switched off for the whole Mac. Reading
    // these never asks.
    func checkAccess() {
        // Allowed in System Settings while Startbar runs.
        if CBManager.authorization == .allowedAlways { startBluetooth() }
        let next = ["location": locationAccess(), "bluetooth": bluetoothAccess(), "automation": automationAccess()]
        if next != access {
            access = next
            changed()
        }
    }

    func locationAccess() -> String {
        guard CLLocationManager.locationServicesEnabled() else { return "off" }
        let status = location.authorizationStatus
        if status == .notDetermined { return "notAsked" }
        return status.rawValue >= CLAuthorizationStatus.authorizedAlways.rawValue ? "allowed" : "denied"
    }

    func bluetoothAccess() -> String {
        switch CBManager.authorization {
        case .allowedAlways: return "allowed"
        case .notDetermined: return "notAsked"
        default: return "denied"
        }
    }

    // macOS only answers while System Events is running. Otherwise unknown,
    // and the main process goes by the last answer it saw.
    func automationAccess() -> String {
        let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
        guard let desc = target.aeDesc else { return "unknown" }
        switch AEDeterminePermissionToAutomateTarget(desc, typeWildCard, typeWildCard, false) {
        case noErr: return "allowed"
        case OSStatus(errAEEventNotPermitted): return "denied"
        case OSStatus(errAEEventWouldRequireUserConsent): return "notAsked"
        default: return "unknown"
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { checkAccess() }

    func askLocation() -> String? {
        guard CLLocationManager.locationServicesEnabled() else { return "Location Services is off" }
        location.requestWhenInUseAuthorization()
        return nil
    }

    // MARK: Commands

    func readCommands() {
        Thread.detachNewThread {
            while let line = readLine(strippingNewline: true) {
                DispatchQueue.main.async { self.handle(line) }
            }
            DispatchQueue.main.async { exit(0) }
        }
    }

    func handle(_ line: String) {
        guard let data = line.data(using: .utf8),
              let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let name = command["cmd"] as? String else {
            jsonLine(["type": "reply", "ok": false, "error": "not a command"])
            return
        }
        var reply: [String: Any] = ["type": "reply", "cmd": name]
        if let seq = command["seq"] { reply["seq"] = seq }
        var error: String?
        switch name {
        case "setVolume": error = setVolume(command["level"] as? Double ?? 0)
        case "setMuted": error = setMuted(command["muted"] as? Bool ?? false)
        case "setWifi": error = setWifi(command["on"] as? Bool ?? true)
        case "setBluetooth": error = setBluetooth(command["on"] as? Bool ?? true)
        case "setConnected": error = setConnected(command["address"] as? String ?? "", command["on"] as? Bool ?? true)
        case "askLocation": error = askLocation()
        case "askBluetooth": startBluetooth()
        case "access": checkAccess()
        case "refresh": lastLine = ""
        default: error = "unknown command"
        }
        reply["ok"] = error == nil
        if let error { reply["error"] = error }
        jsonLine(reply)
        emit()
    }
}

var statusWatcher: StatusWatcher?

// MARK: - Entry

let args = CommandLine.arguments
let usage = "usage: startbar-helper icons <cacheDir> | startbar-helper windows | startbar-helper screen-access | startbar-helper status"
guard args.count >= 2 else { fail(usage) }
switch args[1] {
case "icons":
    guard args.count >= 3 else { fail(usage) }
    runIcons(cacheDir: args[2])
case "windows":
    let watcher = WindowWatcher()
    watcher.start()
    RunLoop.main.run()
case "screen-access":
    jsonLine(["allowed": CGPreflightScreenCaptureAccess()])
case "status":
    statusWatcher = StatusWatcher()
    statusWatcher?.start()
    RunLoop.main.run()
default:
    fail("unknown command \(args[1])")
}
