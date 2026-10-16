// Startbar helper. Compiled at install time by scripts/build-helper.js.
// Talks to the Electron side over stdin and stdout, one JSON line per message.
//
// Commands:
//   startbar-helper icons <cacheDir>
//     Reads app paths from stdin, one per line. Writes each app's icon as a
//     64 px PNG into cacheDir and prints {"path": ..., "png": ...} per app.
//
// Window listing and activation arrive with the next slice.
import AppKit
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

func jsonLine(_ dict: [String: String]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict), let text = String(data: data, encoding: .utf8) {
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

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: startbar-helper icons <cacheDir>") }
switch args[1] {
case "icons":
    guard args.count >= 3 else { fail("usage: startbar-helper icons <cacheDir>") }
    runIcons(cacheDir: args[2])
default:
    fail("unknown command \(args[1])")
}
