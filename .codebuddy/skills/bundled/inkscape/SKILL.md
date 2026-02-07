---
name: inkscape
version: 1.0.0
description: Automate Inkscape vector graphics via CLI, Extensions API, and MCP integration
author: Code Buddy
tags: design, vector, svg, graphics, inkscape, cli, mcp
env:
  INKSCAPE_PROFILE_DIR: ""
  INKSCAPE_EXTENSIONS_PATH: ""
---

# Inkscape Vector Graphics Automation

Automate Inkscape workflows for SVG creation, manipulation, and export using CLI commands, Python Extensions API, and the Shriinivas/inkmcp MCP server for programmatic vector graphics.

## Direct Control (CLI / API / Scripting)

### CLI Basic Operations

```bash
# Convert SVG to PNG
inkscape input.svg --export-filename=output.png --export-width=1200

# Export at specific DPI
inkscape input.svg --export-filename=output.png --export-dpi=300

# Export to PDF
inkscape input.svg --export-filename=output.pdf

# Export to EPS (for print)
inkscape input.svg --export-filename=output.eps --export-text-to-path

# Export specific object by ID
inkscape input.svg --export-id=rect123 --export-filename=rect.png

# Export all objects with IDs
inkscape input.svg --export-id-only --export-filename=objects.png
```

### Batch Conversions

```bash
# Convert all SVGs in directory to PNG
for file in *.svg; do
  inkscape "$file" --export-filename="${file%.svg}.png" --export-width=1024
done

# Create multiple sizes (responsive images)
for size in 320 640 1024 1920; do
  inkscape logo.svg --export-filename="logo-${size}w.png" --export-width=$size
done

# Convert to WebP via PNG intermediate
for file in icons/*.svg; do
  name=$(basename "$file" .svg)
  inkscape "$file" --export-filename="/tmp/${name}.png" --export-width=512
  cwebp -q 90 "/tmp/${name}.png" -o "icons/${name}.webp"
  rm "/tmp/${name}.png"
done
```

### Advanced CLI Usage

```bash
# Modify SVG and export (using --actions)
inkscape input.svg \
  --actions="select-all;object-stroke-to-path;export-filename:output.svg;export-do" \
  --batch-process

# Query object information
inkscape --query-all input.svg

# Query specific object dimensions
inkscape --query-id=rect123 --query-x --query-y --query-width --query-height input.svg

# Vacuum (clean up) SVG file
inkscape input.svg --vacuum-defs --export-filename=cleaned.svg

# Convert text to paths (for font-independent rendering)
inkscape input.svg --export-text-to-path --export-filename=no-fonts.svg

# Apply transformations
inkscape input.svg \
  --actions="select-all;transform-rotate:45;transform-scale:1.5" \
  --export-filename=transformed.svg \
  --batch-process
```

### Python Extension API

Extensions go in `~/.config/inkscape/extensions/` or `/usr/share/inkscape/extensions/`

```python
#!/usr/bin/env python3
# batch_export.inx - Extension descriptor

<?xml version="1.0" encoding="UTF-8"?>
<inkscape-extension xmlns="http://www.inkscape.org/namespace/inkscape/extension">
  <name>Batch Export Objects</name>
  <id>org.codebuddy.batch_export</id>
  <param name="format" type="optiongroup" gui-text="Export Format:">
    <option value="png">PNG</option>
    <option value="pdf">PDF</option>
    <option value="svg">SVG</option>
  </param>
  <param name="width" type="int" min="100" max="5000" gui-text="Width (px):">1024</param>
  <param name="directory" type="path" mode="folder" gui-text="Output Directory:" />
  <effect>
    <object-type>all</object-type>
    <effects-menu>
      <submenu name="Export"/>
    </effects-menu>
  </effect>
  <script>
    <command location="inx" interpreter="python">batch_export.py</command>
  </script>
</inkscape-extension>
```

```python
#!/usr/bin/env python3
# batch_export.py - Extension implementation

import inkex
import os
import subprocess

class BatchExport(inkex.EffectExtension):
    """Export all objects with IDs to separate files"""

    def add_arguments(self, pars):
        pars.add_argument("--format", default="png", help="Export format")
        pars.add_argument("--width", type=int, default=1024, help="Export width")
        pars.add_argument("--directory", default="~/exports", help="Output directory")

    def effect(self):
        # Get all objects with IDs
        svg = self.document.getroot()
        objects = svg.xpath('//*[@id]')

        output_dir = os.path.expanduser(self.options.directory)
        os.makedirs(output_dir, exist_ok=True)

        for obj in objects:
            obj_id = obj.get('id')
            obj_label = obj.get(inkex.addNS('label', 'inkscape')) or obj_id

            # Sanitize filename
            filename = obj_label.replace(' ', '_').replace('/', '_')
            output_path = os.path.join(output_dir, f"{filename}.{self.options.format}")

            # Export using Inkscape CLI
            cmd = [
                'inkscape',
                self.options.input_file,
                f'--export-id={obj_id}',
                '--export-id-only',
                f'--export-filename={output_path}'
            ]

            if self.options.format == 'png':
                cmd.append(f'--export-width={self.options.width}')

            subprocess.run(cmd, check=True)
            inkex.errormsg(f"Exported {obj_label} to {output_path}")

if __name__ == '__main__':
    BatchExport().run()
```

### Generate SVG Programmatically

```python
#!/usr/bin/env python3
# generate_icons.py - Create SVG icons programmatically

import inkex
from inkex import Rectangle, Circle, Path, Group, TextElement

def create_icon(icon_type, size=48):
    """Generate common UI icons"""

    svg = inkex.SvgDocumentElement()
    svg.set('width', str(size))
    svg.set('height', str(size))
    svg.set('viewBox', f'0 0 {size} {size}')

    if icon_type == 'hamburger':
        # Menu hamburger icon
        for i, y in enumerate([12, 24, 36]):
            rect = Rectangle()
            rect.set('x', '8')
            rect.set('y', str(y))
            rect.set('width', '32')
            rect.set('height', '4')
            rect.set('fill', '#000000')
            rect.set('rx', '2')
            svg.append(rect)

    elif icon_type == 'close':
        # X close icon
        path = Path()
        path.set('d', 'M12,12 L36,36 M36,12 L12,36')
        path.set('stroke', '#000000')
        path.set('stroke-width', '4')
        path.set('stroke-linecap', 'round')
        svg.append(path)

    elif icon_type == 'checkmark':
        # Checkmark icon
        path = Path()
        path.set('d', 'M10,24 L18,32 L38,12')
        path.set('stroke', '#00AA00')
        path.set('stroke-width', '4')
        path.set('stroke-linecap', 'round')
        path.set('stroke-linejoin', 'round')
        path.set('fill', 'none')
        svg.append(path)

    elif icon_type == 'search':
        # Search magnifying glass
        circle = Circle()
        circle.set('cx', '20')
        circle.set('cy', '20')
        circle.set('r', '12')
        circle.set('stroke', '#000000')
        circle.set('stroke-width', '3')
        circle.set('fill', 'none')
        svg.append(circle)

        path = Path()
        path.set('d', 'M29,29 L40,40')
        path.set('stroke', '#000000')
        path.set('stroke-width', '3')
        path.set('stroke-linecap', 'round')
        svg.append(path)

    return svg.tostring()

# Generate icon set
icons = ['hamburger', 'close', 'checkmark', 'search']
for icon in icons:
    svg_content = create_icon(icon, size=48)
    with open(f'icon-{icon}.svg', 'w') as f:
        f.write(svg_content)
    print(f"Generated icon-{icon}.svg")
```

### Modify Existing SVG

```python
#!/usr/bin/env python3
# modify_svg.py - Programmatic SVG modifications

import inkex
from lxml import etree

def batch_modify_colors(input_file, output_file, old_color, new_color):
    """Replace all instances of a color in SVG"""

    tree = etree.parse(input_file)
    root = tree.getroot()

    # Find all elements with fill attribute
    for elem in root.iter():
        fill = elem.get('fill')
        if fill == old_color:
            elem.set('fill', new_color)

        stroke = elem.get('stroke')
        if stroke == old_color:
            elem.set('stroke', new_color)

        # Check style attribute
        style = elem.get('style')
        if style:
            style = style.replace(f'fill:{old_color}', f'fill:{new_color}')
            style = style.replace(f'stroke:{old_color}', f'stroke:{new_color}')
            elem.set('style', style)

    tree.write(output_file)
    print(f"Modified {input_file} -> {output_file}")

# Change brand colors across all assets
batch_modify_colors('logo.svg', 'logo-new-brand.svg', '#FF0000', '#0066FF')
```

### Automation Script: SVG Optimization Pipeline

```bash
#!/bin/bash
# optimize-svgs.sh - Clean and optimize SVG files

INPUT_DIR="./raw-svgs"
OUTPUT_DIR="./optimized-svgs"

mkdir -p "$OUTPUT_DIR"

for svg in "$INPUT_DIR"/*.svg; do
  filename=$(basename "$svg")
  echo "Processing $filename..."

  # 1. Vacuum defs (remove unused definitions)
  inkscape "$svg" --vacuum-defs --export-filename="/tmp/step1.svg"

  # 2. Convert text to paths
  inkscape "/tmp/step1.svg" --export-text-to-path --export-filename="/tmp/step2.svg"

  # 3. Simplify paths (reduce nodes)
  inkscape "/tmp/step2.svg" \
    --actions="select-all;path-simplify;export-filename:/tmp/step3.svg;export-do" \
    --batch-process

  # 4. Optimize with SVGO
  npx svgo "/tmp/step3.svg" -o "$OUTPUT_DIR/$filename"

  # Clean up temp files
  rm /tmp/step*.svg

  echo "✓ Optimized $filename"
done

echo "Done! Optimized $(ls $OUTPUT_DIR | wc -l) files."
```

## MCP Server Integration

The Shriinivas/inkmcp MCP server provides tool-based access to Inkscape's capabilities through an MCP interface.

### Configuration (.codebuddy/mcp.json)

```json
{
  "mcpServers": {
    "inkscape": {
      "command": "python",
      "args": ["-m", "inkmcp"],
      "env": {
        "INKSCAPE_EXECUTABLE": "/usr/bin/inkscape",
        "INKSCAPE_EXTENSIONS_PATH": "${HOME}/.config/inkscape/extensions"
      }
    }
  }
}
```

### Available MCP Tools

1. **create_svg** - Create new SVG document
   - Input: `width` (number), `height` (number), `units` (px/mm/in)
   - Returns: SVG document ID

2. **add_rectangle** - Add rectangle to SVG
   - Input: `svg_id` (string), `x` (number), `y` (number), `width` (number), `height` (number), `fill` (color), `stroke` (color), `stroke_width` (number)
   - Returns: Element ID

3. **add_circle** - Add circle to SVG
   - Input: `svg_id` (string), `cx` (number), `cy` (number), `r` (number), `fill` (color)
   - Returns: Element ID

4. **add_path** - Add path element
   - Input: `svg_id` (string), `d` (path data), `fill` (color), `stroke` (color)
   - Returns: Element ID

5. **add_text** - Add text element
   - Input: `svg_id` (string), `text` (string), `x` (number), `y` (number), `font_family` (string), `font_size` (number), `fill` (color)
   - Returns: Element ID

6. **transform_element** - Apply transformation
   - Input: `svg_id` (string), `element_id` (string), `transform` (translate/rotate/scale), `params` (array)
   - Returns: Success status

7. **export_svg** - Export to various formats
   - Input: `svg_id` (string), `output_path` (string), `format` (png/pdf/eps/svg), `width` (number), `dpi` (number)
   - Returns: Export path

8. **query_element** - Get element properties
   - Input: `svg_id` (string), `element_id` (string)
   - Returns: Element bounds and attributes

9. **modify_style** - Change element styling
   - Input: `svg_id` (string), `element_id` (string), `properties` (object with fill/stroke/opacity)
   - Returns: Success status

10. **group_elements** - Create group from elements
    - Input: `svg_id` (string), `element_ids` (array)
    - Returns: Group ID

11. **convert_text_to_path** - Convert text to path
    - Input: `svg_id` (string), `text_element_id` (string)
    - Returns: Path element ID

## Common Workflows

### 1. Generate Social Media Templates

```bash
#!/bin/bash
# social-templates.sh - Create social media graphic templates

# Instagram Post (1080x1080)
inkscape --pipe <<EOF > instagram-template.svg
<?xml version="1.0"?>
<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1080" fill="#f0f0f0"/>
  <rect x="100" y="100" width="880" height="880" fill="#ffffff" rx="20"/>
  <text x="540" y="600" font-family="Arial" font-size="72" text-anchor="middle" fill="#333333">
    Your Content Here
  </text>
</svg>
EOF

inkscape instagram-template.svg --export-filename=instagram-template.png --export-dpi=96

# Twitter/X Post (1200x675)
inkscape --pipe <<EOF > twitter-template.svg
<?xml version="1.0"?>
<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="675" fill="#1DA1F2"/>
  <text x="600" y="350" font-family="Arial Black" font-size="64" text-anchor="middle" fill="#ffffff">
    Tweet Content
  </text>
</svg>
EOF

inkscape twitter-template.svg --export-filename=twitter-template.png --export-dpi=96

echo "Created social media templates"
```

### 2. Icon Set Generation via MCP

```typescript
// Using Code Buddy with Inkscape MCP
// Ask: "Create a set of navigation icons: home, search, profile, settings"

async function generateIconSet() {
  const size = 24;
  const icons = [];

  // Home icon
  const homeSvg = await mcp.call('inkscape', 'create_svg', {
    width: size,
    height: size,
    units: 'px'
  });

  await mcp.call('inkscape', 'add_path', {
    svg_id: homeSvg.id,
    d: 'M12,3 L20,10 L20,20 L4,20 L4,10 Z',
    fill: 'none',
    stroke: '#000000',
    stroke_width: 2
  });

  await mcp.call('inkscape', 'export_svg', {
    svg_id: homeSvg.id,
    output_path: './icons/home.svg',
    format: 'svg'
  });

  // Search icon (magnifying glass)
  const searchSvg = await mcp.call('inkscape', 'create_svg', {
    width: size,
    height: size
  });

  const circleId = await mcp.call('inkscape', 'add_circle', {
    svg_id: searchSvg.id,
    cx: 10,
    cy: 10,
    r: 7,
    fill: 'none',
    stroke: '#000000',
    stroke_width: 2
  });

  await mcp.call('inkscape', 'add_path', {
    svg_id: searchSvg.id,
    d: 'M15,15 L21,21',
    stroke: '#000000',
    stroke_width: 2
  });

  await mcp.call('inkscape', 'export_svg', {
    svg_id: searchSvg.id,
    output_path: './icons/search.svg',
    format: 'svg'
  });

  // Export all as PNG at multiple sizes
  for (const size of [16, 24, 32, 48]) {
    await mcp.call('inkscape', 'export_svg', {
      svg_id: homeSvg.id,
      output_path: `./icons/home-${size}.png`,
      format: 'png',
      width: size
    });
  }
}
```

### 3. Batch SVG Color Replacement

```python
#!/usr/bin/env python3
# recolor-brand.py - Update brand colors across all assets

import os
import glob
from lxml import etree

COLOR_MAP = {
    '#FF5733': '#0066FF',  # Old red -> New blue
    '#C70039': '#00AA00',  # Old crimson -> New green
    '#900C3F': '#FFD700',  # Old burgundy -> New gold
}

def replace_colors(svg_file, color_map):
    """Replace colors in SVG file"""
    tree = etree.parse(svg_file)
    root = tree.getroot()

    modified = False

    for elem in root.iter():
        # Check fill
        fill = elem.get('fill')
        if fill in color_map:
            elem.set('fill', color_map[fill])
            modified = True

        # Check stroke
        stroke = elem.get('stroke')
        if stroke in color_map:
            elem.set('stroke', color_map[stroke])
            modified = True

        # Check style attribute
        style = elem.get('style')
        if style:
            for old, new in color_map.items():
                if old in style:
                    style = style.replace(old, new)
                    elem.set('style', style)
                    modified = True

    if modified:
        tree.write(svg_file)
        print(f"✓ Updated {svg_file}")

# Process all SVGs
for svg_file in glob.glob('assets/**/*.svg', recursive=True):
    replace_colors(svg_file, COLOR_MAP)

print("Brand colors updated!")
```

### 4. Responsive Image Export

```bash
#!/bin/bash
# responsive-export.sh - Generate responsive image sizes

INPUT_SVG="$1"
BASENAME=$(basename "$INPUT_SVG" .svg)
OUTPUT_DIR="./responsive"

mkdir -p "$OUTPUT_DIR"

# Widths for responsive images
WIDTHS=(320 640 768 1024 1366 1920)

for width in "${WIDTHS[@]}"; do
  output="${OUTPUT_DIR}/${BASENAME}-${width}w.png"
  inkscape "$INPUT_SVG" --export-filename="$output" --export-width=$width
  echo "✓ Exported ${width}px version"

  # Also create WebP version
  cwebp -q 85 "$output" -o "${OUTPUT_DIR}/${BASENAME}-${width}w.webp"
done

# Generate srcset HTML snippet
echo "<img src=\"${BASENAME}-1024w.png\""
echo -n "     srcset=\""
for width in "${WIDTHS[@]}"; do
  echo -n "${BASENAME}-${width}w.webp ${width}w, "
done | sed 's/, $//'
echo "\""
echo "     sizes=\"(max-width: 768px) 100vw, 50vw\""
echo "     alt=\"Image description\">"
```

### 5. PDF Poster/Flyer Generation

```bash
#!/bin/bash
# generate-poster.sh - Create print-ready PDF poster

# Create SVG template
cat > poster.svg <<EOF
<?xml version="1.0"?>
<svg width="297mm" height="420mm" viewBox="0 0 297 420"
     xmlns="http://www.w3.org/2000/svg">

  <!-- Background -->
  <rect width="297" height="420" fill="#2C3E50"/>

  <!-- Header -->
  <text x="148.5" y="60" font-family="Impact" font-size="48"
        text-anchor="middle" fill="#ECF0F1">
    SUMMER SALE
  </text>

  <!-- Subheading -->
  <text x="148.5" y="90" font-family="Arial" font-size="24"
        text-anchor="middle" fill="#E74C3C">
    Up to 50% OFF
  </text>

  <!-- Content area -->
  <rect x="20" y="120" width="257" height="260"
        fill="#ECF0F1" rx="10"/>

  <!-- Footer -->
  <text x="148.5" y="400" font-family="Arial" font-size="14"
        text-anchor="middle" fill="#95A5A6">
    www.example.com | info@example.com
  </text>

</svg>
EOF

# Export to print-ready PDF (300 DPI)
inkscape poster.svg \
  --export-filename=poster.pdf \
  --export-dpi=300 \
  --export-area-page

# Also create preview PNG
inkscape poster.svg \
  --export-filename=poster-preview.png \
  --export-width=2480  # A3 width at 300 DPI

echo "✓ Generated poster.pdf (print-ready)"
echo "✓ Generated poster-preview.png"
```

### 6. Automated Logo Variants

```bash
#!/bin/bash
# logo-variants.sh - Generate logo in multiple formats and colors

LOGO_SVG="logo.svg"

# Color variants
declare -A VARIANTS=(
  ["dark"]="#000000"
  ["light"]="#FFFFFF"
  ["brand"]="#0066FF"
)

for variant in "${!VARIANTS[@]}"; do
  color="${VARIANTS[$variant]}"

  # Create color variant
  python3 <<EOF
from lxml import etree
tree = etree.parse('$LOGO_SVG')
root = tree.getroot()
for elem in root.iter():
    if elem.get('fill') and elem.get('fill') != 'none':
        elem.set('fill', '$color')
tree.write('logo-${variant}.svg')
EOF

  # Export formats
  inkscape "logo-${variant}.svg" --export-filename="logo-${variant}.png" --export-width=512
  inkscape "logo-${variant}.svg" --export-filename="logo-${variant}.pdf"
  inkscape "logo-${variant}.svg" --export-filename="logo-${variant}-small.png" --export-width=128

  echo "✓ Generated $variant variant"
done

echo "Logo variants complete!"
```
