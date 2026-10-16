// Draws the Startbar app icon into an .iconset folder.
// Run from the repo root:
//   swift design/draw-icon.swift /tmp/Startbar.iconset
//   iconutil -c icns /tmp/Startbar.iconset -o assets/Startbar.icns
// The icon is a blue desktop with a window and the bar along the bottom:
// a Start button, two window buttons and a clock.
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Startbar.iconset"
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

func rounded(_ r: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

// Everything is drawn on a 1024 canvas, origin bottom left, then scaled.
func draw(_ ctx: CGContext) {
    let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
    let tilePath = rounded(tile, 185)

    // Soft shadow under the tile, like the system icons.
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: rgb(0x000000, 0.30))
    ctx.addPath(tilePath)
    ctx.setFillColor(rgb(0x0a64d8))
    ctx.fillPath()
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addPath(tilePath)
    ctx.clip()

    // Desktop.
    let sky = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                         colors: [rgb(0x5ac8fa), rgb(0x0a84ff), rgb(0x0a5bd0)] as CFArray,
                         locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(sky, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])

    // A window on the desktop.
    let win = CGRect(x: 236, y: 372, width: 552, height: 420)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -8), blur: 24, color: rgb(0x002a66, 0.35))
    ctx.addPath(rounded(win, 40))
    ctx.setFillColor(rgb(0xffffff))
    ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(rounded(win, 40))
    ctx.clip()
    ctx.setFillColor(rgb(0xe9edf2))
    ctx.fill(CGRect(x: win.minX, y: win.maxY - 84, width: win.width, height: 84))
    ctx.restoreGState()
    for (i, c) in [0xff5f57, 0xfebc2e, 0x28c840].enumerated() {
        ctx.setFillColor(rgb(UInt32(c)))
        ctx.fillEllipse(in: CGRect(x: win.minX + 36 + CGFloat(i) * 46, y: win.maxY - 58, width: 32, height: 32))
    }
    ctx.setFillColor(rgb(0xd5dbe3))
    for (i, w) in [380.0, 300.0, 340.0].enumerated() {
        ctx.addPath(rounded(CGRect(x: win.minX + 48, y: win.maxY - 150 - CGFloat(i) * 62, width: CGFloat(w), height: 26), 13))
        ctx.fillPath()
    }

    // The bar along the bottom edge.
    ctx.setFillColor(rgb(0xf7f8fa, 0.94))
    ctx.fill(CGRect(x: 100, y: 100, width: 824, height: 196))
    ctx.setFillColor(rgb(0x000000, 0.10))
    ctx.fill(CGRect(x: 100, y: 294, width: 824, height: 3))

    // Start button with the Start glyph.
    let start = CGRect(x: 168, y: 158, width: 200, height: 92)
    ctx.addPath(rounded(start, 46))
    ctx.setFillColor(rgb(0x0a84ff))
    ctx.fillPath()
    let glyph = CGRect(x: start.midX - 44, y: start.midY - 34, width: 88, height: 68)
    ctx.addPath(rounded(glyph, 12))
    ctx.setFillColor(rgb(0xffffff))
    ctx.fillPath()
    ctx.setFillColor(rgb(0x0a84ff))
    ctx.addPath(rounded(CGRect(x: glyph.minX + 14, y: glyph.minY + 30, width: 60, height: 10), 5))
    ctx.addPath(rounded(CGRect(x: glyph.minX + 14, y: glyph.minY + 13, width: 38, height: 10), 5))
    ctx.fillPath()

    // Two window buttons, the first one pressed.
    ctx.addPath(rounded(CGRect(x: 396, y: 158, width: 176, height: 92), 22))
    ctx.setFillColor(rgb(0x0a84ff, 0.20))
    ctx.fillPath()
    ctx.addPath(rounded(CGRect(x: 588, y: 158, width: 132, height: 92), 22))
    ctx.setFillColor(rgb(0x000000, 0.07))
    ctx.fillPath()
    ctx.setFillColor(rgb(0x0a84ff))
    ctx.addPath(rounded(CGRect(x: 418, y: 186, width: 36, height: 36), 9))
    ctx.fillPath()
    ctx.setFillColor(rgb(0x8e8e93))
    ctx.addPath(rounded(CGRect(x: 610, y: 186, width: 36, height: 36), 9))
    ctx.fillPath()

    // Clock.
    ctx.setFillColor(rgb(0x3a3a3c))
    ctx.addPath(rounded(CGRect(x: 760, y: 196, width: 104, height: 18), 9))
    ctx.addPath(rounded(CGRect(x: 776, y: 168, width: 72, height: 14), 7))
    ctx.fillPath()

    ctx.restoreGState()
}

let sizes: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024)
]
for (name, px) in sizes {
    let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.scaleBy(x: CGFloat(px) / 1024, y: CGFloat(px) / 1024)
    draw(ctx)
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
}
print("Wrote \(sizes.count) images to \(out)")
