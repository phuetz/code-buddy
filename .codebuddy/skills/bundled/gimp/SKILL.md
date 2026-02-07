---
name: gimp
version: 1.0.0
description: Automate GIMP image editing via Python-Fu scripting, CLI batch processing, and MCP integration
author: Code Buddy
tags: design, image-editing, photo, graphics, gimp, python-fu, mcp
env:
  GIMP_PLUGIN_PATH: ""
  GIMP_SCRIPTS_PATH: ""
---

# GIMP Image Automation

Automate GIMP (GNU Image Manipulation Program) workflows using Python-Fu scripting, Script-Fu (Scheme), CLI batch mode, and the libreearth/gimp-mcp server for programmatic image editing.

## Direct Control (CLI / API / Scripting)

### CLI Batch Mode

```bash
# Basic batch processing
gimp -i -b '(batch-command)' -b '(gimp-quit 0)'

# Resize image
gimp -i -b '(let* ((image (car (gimp-file-load RUN-NONINTERACTIVE "input.jpg" "input.jpg")))
              (drawable (car (gimp-image-get-active-layer image))))
         (gimp-image-scale image 800 600)
         (gimp-file-save RUN-NONINTERACTIVE image drawable "output.jpg" "output.jpg")
         (gimp-image-delete image))' -b '(gimp-quit 0)'

# Convert to grayscale
gimp -i -b '(let* ((image (car (gimp-file-load RUN-NONINTERACTIVE "input.png" "input.png")))
              (drawable (car (gimp-image-get-active-layer image))))
         (gimp-image-convert-grayscale image)
         (gimp-file-save RUN-NONINTERACTIVE image drawable "output.png" "output.png")
         (gimp-image-delete image))' -b '(gimp-quit 0)'

# Batch process entire directory
for file in images/*.jpg; do
  gimp -i -b "(let* ((image (car (gimp-file-load RUN-NONINTERACTIVE \"$file\" \"$file\")))
                (drawable (car (gimp-image-get-active-layer image))))
           (gimp-image-scale image 1200 800)
           (gimp-file-save RUN-NONINTERACTIVE image drawable \"processed/$file\" \"processed/$file\")
           (gimp-image-delete image))" -b '(gimp-quit 0)'
done
```

### Python-Fu Scripts

Save to `~/.config/GIMP/2.10/plug-ins/` or `/usr/share/gimp/2.0/scripts/`

```python
#!/usr/bin/env python
# batch-watermark.py - Add watermark to images

from gimpfu import *

def add_watermark(image, drawable, watermark_text, position):
    """Add text watermark to image"""

    # Get image dimensions
    width = image.width
    height = image.height

    # Create text layer
    text_layer = pdb.gimp_text_fontname(
        image, None,
        0, 0,  # x, y coordinates
        watermark_text,
        10,  # border
        True,  # antialias
        72,  # font size
        PIXELS,
        "Sans Bold"
    )

    # Position watermark
    if position == "bottom-right":
        x = width - text_layer.width - 20
        y = height - text_layer.height - 20
    elif position == "bottom-left":
        x = 20
        y = height - text_layer.height - 20
    elif position == "center":
        x = (width - text_layer.width) / 2
        y = (height - text_layer.height) / 2
    else:  # top-right
        x = width - text_layer.width - 20
        y = 20

    pdb.gimp_layer_set_offsets(text_layer, x, y)

    # Set opacity
    pdb.gimp_layer_set_opacity(text_layer, 70)

    # Flatten image
    merged = pdb.gimp_image_flatten(image)

    return

register(
    "python-fu-batch-watermark",
    "Add watermark to image",
    "Adds text watermark to image at specified position",
    "Code Buddy",
    "Code Buddy",
    "2024",
    "<Image>/Filters/Watermark/Add Text Watermark",
    "*",
    [
        (PF_STRING, "watermark_text", "Watermark Text", "© 2024"),
        (PF_OPTION, "position", "Position", 0, ["top-right", "bottom-right", "bottom-left", "center"])
    ],
    [],
    add_watermark
)

main()
```

### Advanced Python-Fu: Batch Photo Enhancement

```python
#!/usr/bin/env python
# auto-enhance.py - Automatic photo enhancement

from gimpfu import *
import os

def auto_enhance_photo(input_path, output_path):
    """Enhance photo: adjust levels, sharpen, reduce noise"""

    # Load image
    image = pdb.gimp_file_load(input_path, input_path)
    drawable = pdb.gimp_image_get_active_layer(image)

    # Auto levels
    pdb.gimp_levels_stretch(drawable)

    # Auto contrast
    pdb.plug_in_c_astretch(image, drawable)

    # Sharpen (unsharp mask)
    pdb.plug_in_unsharp_mask(
        image, drawable,
        5.0,   # radius
        0.5,   # amount
        0      # threshold
    )

    # Reduce noise
    pdb.plug_in_despeckle(
        image, drawable,
        3,     # radius
        1,     # type (median)
        -1,    # black level
        255    # white level
    )

    # Increase saturation slightly
    pdb.gimp_hue_saturation(
        drawable,
        0,     # hue-saturation mode (all)
        0,     # hue offset
        0,     # lightness
        15     # saturation boost
    )

    # Save
    pdb.gimp_file_save(image, drawable, output_path, output_path)
    pdb.gimp_image_delete(image)

# Batch process directory
def batch_enhance(source_dir, dest_dir):
    if not os.path.exists(dest_dir):
        os.makedirs(dest_dir)

    for filename in os.listdir(source_dir):
        if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
            input_path = os.path.join(source_dir, filename)
            output_path = os.path.join(dest_dir, filename)
            print(f"Processing {filename}...")
            auto_enhance_photo(input_path, output_path)

register(
    "python-fu-auto-enhance",
    "Auto enhance photos",
    "Automatically enhance photos with levels, sharpening, and noise reduction",
    "Code Buddy",
    "Code Buddy",
    "2024",
    "<Image>/Filters/Enhance/Auto Enhance Photo",
    "*",
    [],
    [],
    lambda img, drw: auto_enhance_photo(img.filename, img.filename)
)

main()
```

### Script-Fu Examples

```scheme
; resize-and-save.scm
(define (batch-resize-image filename new-width new-height)
  (let* ((image (car (gimp-file-load RUN-NONINTERACTIVE filename filename)))
         (drawable (car (gimp-image-get-active-layer image))))
    (gimp-image-scale image new-width new-height)
    (gimp-file-save RUN-NONINTERACTIVE image drawable filename filename)
    (gimp-image-delete image)))

; create-thumbnail.scm
(define (create-thumbnail input-file output-file thumb-size)
  (let* ((image (car (gimp-file-load RUN-NONINTERACTIVE input-file input-file)))
         (drawable (car (gimp-image-get-active-layer image)))
         (width (car (gimp-image-width image)))
         (height (car (gimp-image-height image)))
         (new-width thumb-size)
         (new-height (* height (/ thumb-size width))))
    (gimp-image-scale image new-width new-height)
    (gimp-file-save RUN-NONINTERACTIVE image drawable output-file output-file)
    (gimp-image-delete image)))
```

### Python Direct API (via gimp-python)

```python
# advanced-editing.py
import sys
sys.path.append('/usr/lib/gimp/2.0/python')

from gimpfu import *

def create_social_media_template(width, height, bg_color, text):
    """Create a social media post template"""

    # Create new image
    image = pdb.gimp_image_new(width, height, RGB)

    # Create background layer
    bg_layer = pdb.gimp_layer_new(
        image, width, height,
        RGB_IMAGE, "Background",
        100, NORMAL_MODE
    )
    pdb.gimp_image_insert_layer(image, bg_layer, None, 0)

    # Fill with color
    pdb.gimp_context_set_foreground(bg_color)
    pdb.gimp_drawable_fill(bg_layer, FOREGROUND_FILL)

    # Add text
    text_layer = pdb.gimp_text_fontname(
        image, None,
        width * 0.1, height * 0.4,
        text, 10, True,
        int(width * 0.08), PIXELS,
        "Impact"
    )

    # Center text
    pdb.gimp_layer_set_offsets(
        text_layer,
        (width - text_layer.width) / 2,
        (height - text_layer.height) / 2
    )

    # Create display
    display = pdb.gimp_display_new(image)

    return image

# Run from CLI
if __name__ == "__main__":
    gimp.main(None, None, create_social_media_template, (1080, 1080, (41, 128, 185), "Hello World"))
```

## MCP Server Integration

The libreearth/gimp-mcp server provides tool-based access to GIMP through an MCP interface, enabling programmatic image manipulation.

### Configuration (.codebuddy/mcp.json)

```json
{
  "mcpServers": {
    "gimp": {
      "command": "npx",
      "args": ["-y", "@libreearth/gimp-mcp"],
      "env": {
        "GIMP_EXECUTABLE": "/usr/bin/gimp",
        "GIMP_SCRIPTS_PATH": "${HOME}/.config/GIMP/2.10/plug-ins"
      }
    }
  }
}
```

### Available MCP Tools

1. **open_image** - Load an image file
   - Input: `file_path` (string)
   - Returns: Image ID and metadata (dimensions, color mode)

2. **save_image** - Save image to file
   - Input: `image_id` (number), `file_path` (string), `format` (jpg/png/gif/xcf)
   - Returns: Success status

3. **resize_image** - Scale image to new dimensions
   - Input: `image_id` (number), `width` (number), `height` (number), `interpolation` (none/linear/cubic)
   - Returns: Updated image metadata

4. **crop_image** - Crop to specified rectangle
   - Input: `image_id` (number), `x` (number), `y` (number), `width` (number), `height` (number)
   - Returns: Cropped image metadata

5. **rotate_image** - Rotate by degrees
   - Input: `image_id` (number), `degrees` (90/180/270 or any float), `auto_crop` (boolean)
   - Returns: Rotated image metadata

6. **adjust_brightness_contrast** - Adjust image tone
   - Input: `image_id` (number), `brightness` (-100 to 100), `contrast` (-100 to 100)
   - Returns: Success status

7. **convert_grayscale** - Convert to grayscale
   - Input: `image_id` (number)
   - Returns: Success status

8. **apply_blur** - Apply Gaussian blur
   - Input: `image_id` (number), `radius` (number)
   - Returns: Success status

9. **add_text_layer** - Add text to image
   - Input: `image_id` (number), `text` (string), `x` (number), `y` (number), `font` (string), `size` (number), `color` (hex)
   - Returns: Layer ID

10. **flatten_image** - Merge all layers
    - Input: `image_id` (number)
    - Returns: Success status

11. **batch_process** - Process multiple images with same operations
    - Input: `input_dir` (string), `output_dir` (string), `operations` (array)
    - Returns: Processed file count

## Common Workflows

### 1. Batch Resize Product Photos

```bash
#!/bin/bash
# resize-products.sh

INPUT_DIR="./product-photos"
OUTPUT_DIR="./resized"
TARGET_WIDTH=1200

mkdir -p "$OUTPUT_DIR"

for img in "$INPUT_DIR"/*.jpg; do
  filename=$(basename "$img")
  echo "Resizing $filename..."

  gimp -i -d -f -b "
    (let* ((image (car (gimp-file-load RUN-NONINTERACTIVE \"$img\" \"$img\")))
           (drawable (car (gimp-image-get-active-layer image)))
           (width (car (gimp-image-width image)))
           (height (car (gimp-image-height image)))
           (new-height (* height (/ $TARGET_WIDTH width))))
      (gimp-image-scale image $TARGET_WIDTH new-height)
      (file-jpeg-save RUN-NONINTERACTIVE
                      image drawable
                      \"$OUTPUT_DIR/$filename\" \"$OUTPUT_DIR/$filename\"
                      0.95 0 1 0 \"\" 2 1 0 0)
      (gimp-image-delete image))
  " -b '(gimp-quit 0)'
done

echo "Done! Resized $(ls $OUTPUT_DIR | wc -l) images."
```

### 2. Watermark Batch Processing with Python-Fu

```python
#!/usr/bin/env python
# batch-watermark-runner.py

import os
import subprocess

def apply_watermark_batch(input_dir, output_dir, watermark_text):
    """Apply watermark to all images in directory"""

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    for filename in os.listdir(input_dir):
        if not filename.lower().endswith(('.jpg', '.png', '.jpeg')):
            continue

        input_path = os.path.join(input_dir, filename)
        output_path = os.path.join(output_dir, filename)

        # Run GIMP with Python-Fu script
        cmd = [
            'gimp', '-i', '-d', '-f',
            '-b', f'''
(let* ((image (car (gimp-file-load RUN-NONINTERACTIVE "{input_path}" "{input_path}")))
       (drawable (car (gimp-image-get-active-layer image)))
       (text-layer (car (gimp-text-fontname image drawable
                         10 10 "{watermark_text}" 10 TRUE 48 PIXELS "Sans Bold"))))
  (gimp-layer-set-opacity text-layer 60)
  (gimp-layer-set-offsets text-layer
    (- (car (gimp-image-width image)) (car (gimp-drawable-width text-layer)) 20)
    (- (car (gimp-image-height image)) (car (gimp-drawable-height text-layer)) 20))
  (set! drawable (car (gimp-image-flatten image)))
  (gimp-file-save RUN-NONINTERACTIVE image drawable "{output_path}" "{output_path}")
  (gimp-image-delete image))
            ''',
            '-b', '(gimp-quit 0)'
        ]

        print(f"Processing {filename}...")
        subprocess.run(cmd, check=True)

if __name__ == "__main__":
    apply_watermark_batch("./originals", "./watermarked", "© 2024 MyCompany")
```

### 3. Create Image Variants (Thumbnail, Medium, Large)

```bash
#!/bin/bash
# create-variants.sh

INPUT_IMAGE=$1
BASENAME=$(basename "$INPUT_IMAGE" | sed 's/\.[^.]*$//')

# Thumbnail (300x300)
gimp -i -d -f -b "(let* ((image (car (gimp-file-load RUN-NONINTERACTIVE \"$INPUT_IMAGE\" \"$INPUT_IMAGE\")))
                     (drawable (car (gimp-image-get-active-layer image))))
                (gimp-image-scale-full image 300 300 INTERPOLATION-CUBIC)
                (gimp-file-save RUN-NONINTERACTIVE image drawable \"${BASENAME}_thumb.jpg\" \"${BASENAME}_thumb.jpg\")
                (gimp-image-delete image))" -b '(gimp-quit 0)'

# Medium (800x600)
gimp -i -d -f -b "(let* ((image (car (gimp-file-load RUN-NONINTERACTIVE \"$INPUT_IMAGE\" \"$INPUT_IMAGE\")))
                     (drawable (car (gimp-image-get-active-layer image))))
                (gimp-image-scale-full image 800 600 INTERPOLATION-CUBIC)
                (gimp-file-save RUN-NONINTERACTIVE image drawable \"${BASENAME}_medium.jpg\" \"${BASENAME}_medium.jpg\")
                (gimp-image-delete image))" -b '(gimp-quit 0)'

# Large (1920x1080)
gimp -i -d -f -b "(let* ((image (car (gimp-file-load RUN-NONINTERACTIVE \"$INPUT_IMAGE\" \"$INPUT_IMAGE\")))
                     (drawable (car (gimp-image-get-active-layer image))))
                (gimp-image-scale-full image 1920 1080 INTERPOLATION-CUBIC)
                (gimp-file-save RUN-NONINTERACTIVE image drawable \"${BASENAME}_large.jpg\" \"${BASENAME}_large.jpg\")
                (gimp-image-delete image))" -b '(gimp-quit 0)'

echo "Created 3 variants: ${BASENAME}_thumb.jpg, ${BASENAME}_medium.jpg, ${BASENAME}_large.jpg"
```

### 4. Photo Enhancement Pipeline via MCP

```typescript
// Using Code Buddy with GIMP MCP
// Ask: "Enhance the photo at ./portrait.jpg - adjust brightness, reduce noise, and sharpen"

// Code Buddy will orchestrate:
async function enhancePortrait() {
  // 1. Open image
  const { image_id } = await mcp.call('gimp', 'open_image', {
    file_path: './portrait.jpg'
  });

  // 2. Auto levels
  await mcp.call('gimp', 'adjust_brightness_contrast', {
    image_id,
    brightness: 10,
    contrast: 15
  });

  // 3. Reduce noise (via blur then sharpen)
  await mcp.call('gimp', 'apply_blur', {
    image_id,
    radius: 1.5
  });

  // 4. Sharpen
  await mcp.call('gimp', 'apply_unsharp_mask', {
    image_id,
    radius: 3,
    amount: 0.7
  });

  // 5. Save
  await mcp.call('gimp', 'save_image', {
    image_id,
    file_path: './portrait_enhanced.jpg',
    format: 'jpg'
  });
}
```

### 5. Automated Social Media Graphics Generation

```python
#!/usr/bin/env python
# generate-social-posts.py

from gimpfu import *
import json

def create_social_post(config_file):
    """Generate social media graphics from JSON config"""

    with open(config_file) as f:
        config = json.load(f)

    for post in config['posts']:
        # Create image
        image = pdb.gimp_image_new(post['width'], post['height'], RGB)

        # Background layer
        bg = pdb.gimp_layer_new(image, post['width'], post['height'],
                                RGB_IMAGE, "Background", 100, NORMAL_MODE)
        pdb.gimp_image_insert_layer(image, bg, None, 0)

        # Fill background
        bg_color = tuple(post['background_color'])
        pdb.gimp_context_set_foreground(bg_color)
        pdb.gimp_drawable_fill(bg, FOREGROUND_FILL)

        # Add logo if specified
        if 'logo' in post:
            logo = pdb.gimp_file_load_layer(image, post['logo'])
            pdb.gimp_image_insert_layer(image, logo, None, 0)
            pdb.gimp_layer_scale(logo, post['logo_width'], post['logo_height'], False)
            pdb.gimp_layer_set_offsets(logo, post['logo_x'], post['logo_y'])

        # Add headline text
        headline = pdb.gimp_text_fontname(
            image, None,
            50, post['height'] * 0.4,
            post['headline'],
            10, True, post['font_size'],
            PIXELS, post['font']
        )
        pdb.gimp_text_layer_set_color(headline, tuple(post['text_color']))

        # Center headline
        pdb.gimp_layer_set_offsets(
            headline,
            (post['width'] - headline.width) / 2,
            post['headline_y']
        )

        # Flatten and save
        merged = pdb.gimp_image_flatten(image)
        pdb.gimp_file_save(image, merged, post['output'], post['output'])
        pdb.gimp_image_delete(image)

        print(f"Generated {post['output']}")

# Example config.json:
# {
#   "posts": [
#     {
#       "width": 1200, "height": 630,
#       "background_color": [41, 128, 185],
#       "headline": "New Product Launch!",
#       "headline_y": 250,
#       "text_color": [255, 255, 255],
#       "font": "Impact", "font_size": 72,
#       "logo": "./logo.png",
#       "logo_width": 200, "logo_height": 200,
#       "logo_x": 50, "logo_y": 50,
#       "output": "./social-post-1.jpg"
#     }
#   ]
# }

if __name__ == "__main__":
    create_social_post("config.json")
```
