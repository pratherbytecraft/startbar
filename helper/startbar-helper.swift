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
import AppKit
import ApplicationServices
import Foundation

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
            let icon = NSWorkspace.shared.icon(forFile: path)
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
//     "windows":[{"id","order","title","minimized","focused","onScreen","x","y","w","h"}]}]}
//     Regular apps only. Windows are standard windows and dialogs, empty
//     without the permission. "order" counts up as windows are first seen,
//     "focused" is the app's own focused window, "onScreen" is false for
//     minimized windows, hidden apps and windows on other Spaces.
//   {"type":"reply","seq":n,"cmd":"...","ok":true} or with "error":"..."
// In, one JSON object per line, each with an optional "seq" echoed back:
//   {"cmd":"activate","id":"w123"}    raise the window and bring its app forward
//   {"cmd":"minimize","id":"w123"}    {"cmd":"unminimize","id":"w123"}
//   {"cmd":"close","id":"w123"}       press the window's close button
//   {"cmd":"activateApp","pid":501}   {"cmd":"quitApp","pid":501}
//   {"cmd":"newWindow","pid":501}     bring the app forward and press Command N
//   {"cmd":"refresh"}                 send the state now, even if unchanged
//   {"cmd":"keepOff","top":25,"bottom":830,"screen":{"x":0,"y":0,"w":1512,"h":866}}
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
    var keepOff: (top: CGFloat, bottom: CGFloat, screen: CGRect)?
    var nudgeTried: [String: CGRect] = [:] // window id -> its frame after a move that didn't clear the bar
    var emitPending = false
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
        for window in list {
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
            let item: Known
            if let seen = before.first(where: { CFEqual($0.element, window) }) {
                item = seen
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
        guard let k = keepOff, NSEvent.pressedMouseButtons == 0 else { return }
        guard frame.maxY > k.bottom + 1, frame.maxY <= k.screen.maxY + 1,
              frame.midX >= k.screen.minX, frame.midX < k.screen.maxX,
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
        let error = run(name, command)
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
        case "keepOff":
            nudgeTried.removeAll()
            guard let bottom = command["bottom"] as? Double, let top = command["top"] as? Double,
                  let screen = command["screen"] as? [String: Double],
                  let x = screen["x"], let y = screen["y"], let w = screen["w"], let h = screen["h"] else {
                keepOff = nil
                return nil
            }
            keepOff = (CGFloat(top), CGFloat(bottom), CGRect(x: x, y: y, width: w, height: h))
            return nil
        case "activateApp", "quitApp", "newWindow":
            guard let pid = command["pid"] as? Int, let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
                return "no such app"
            }
            if name == "quitApp" { return app.terminate() ? nil : "the app did not quit" }
            activateApp(app)
            if name == "newWindow" {
                guard trusted else { return "no accessibility permission" }
                newWindow(pid_t(pid))
            }
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

    // Command N, sent straight to the app so it lands even if another app
    // is still in front. Waits a moment for the app to come forward first.
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

// MARK: - Entry

let args = CommandLine.arguments
let usage = "usage: startbar-helper icons <cacheDir> | startbar-helper windows"
guard args.count >= 2 else { fail(usage) }
switch args[1] {
case "icons":
    guard args.count >= 3 else { fail(usage) }
    runIcons(cacheDir: args[2])
case "windows":
    let watcher = WindowWatcher()
    watcher.start()
    RunLoop.main.run()
default:
    fail("unknown command \(args[1])")
}
