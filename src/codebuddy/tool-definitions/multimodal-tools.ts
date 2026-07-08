/**
 * Multimodal Tool Definitions
 *
 * Tools for processing various media types:
 * - PDF documents
 * - Audio files
 * - Video files
 * - Screenshots
 * - Clipboard operations
 * - Office documents
 * - OCR (text extraction from images)
 * - Diagrams
 * - Export functionality
 * - QR codes
 * - Archives
 */

import type { CodeBuddyTool } from './types.js';

// PDF Tool - Read and extract content from PDF files
export const PDF_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "pdf",
    description: "Read and extract content from PDF files. Supports text extraction, metadata reading, and page-specific extraction.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["extract", "info", "list", "to_base64"],
          description: "Operation: extract (get text content), info (get metadata), list (list PDFs in directory), to_base64 (convert to base64)"
        },
        path: {
          type: "string",
          description: "Path to PDF file or directory"
        },
        pages: {
          type: "array",
          items: { type: "number" },
          description: "Specific page numbers to extract (optional)"
        },
        max_pages: {
          type: "number",
          description: "Maximum number of pages to extract (optional)"
        }
      },
      required: ["operation", "path"]
    }
  }
};

// Audio Tool - Process and transcribe audio files
export const AUDIO_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "audio",
    description: "Process and transcribe audio files. Supports info extraction, transcription (via Whisper API), and format conversion.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["info", "transcribe", "list", "to_base64"],
          description: "Operation: info (get audio metadata), transcribe (convert speech to text), list (list audio files), to_base64"
        },
        path: {
          type: "string",
          description: "Path to audio file or directory"
        },
        language: {
          type: "string",
          description: "Language code for transcription (e.g., 'en', 'fr', 'es')"
        },
        prompt: {
          type: "string",
          description: "Optional prompt to guide transcription"
        }
      },
      required: ["operation", "path"]
    }
  }
};

// Hermes Text-to-Speech Tool - Convert text to local speech audio
export const TEXT_TO_SPEECH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "text_to_speech",
    description: "Convert text to a local speech audio file. Returns a MEDIA:path and writes the audio to disk using a configured or detected TTS provider.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to convert to speech audio"
        },
        output_path: {
          type: "string",
          description: "Optional absolute or workspace-relative output path. Defaults to .codebuddy/tts/tts-<id>.<format>"
        },
        provider: {
          type: "string",
          enum: ["auto", "system", "edge-tts", "espeak", "say", "audioreader"],
          description: "TTS provider. auto detects a local provider; system uses Windows SAPI"
        },
        voice: {
          type: "string",
          description: "Optional provider-specific voice name"
        },
        language: {
          type: "string",
          description: "Optional language code for providers such as espeak"
        },
        format: {
          type: "string",
          enum: ["wav", "mp3", "aiff"],
          description: "Output audio format. Defaults by provider"
        },
        rate: {
          type: "number",
          description: "Optional provider-specific speech rate"
        },
        volume: {
          type: "number",
          description: "Optional provider-specific volume"
        },
        timeout_ms: {
          type: "number",
          description: "Provider timeout in milliseconds"
        }
      },
      required: ["text"]
    }
  }
};

// Hermes Image Generation Tool - Generate an image through the configured backend
export const IMAGE_GENERATE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "image_generate",
    description: "Generate an image from a text prompt through the configured image backend. Returns a URL or local MEDIA path in the image field.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text prompt describing the desired image"
        },
        aspect_ratio: {
          type: "string",
          enum: ["landscape", "square", "portrait"],
          description: "Output aspect ratio: landscape (wide), square (1:1), or portrait (tall). Defaults to landscape.",
          default: "landscape"
        }
      },
      required: ["prompt"]
    }
  }
};

// Video Tool - Process video files and extract frames
export const VIDEO_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "video",
    description: "Process video files: get info, extract frames, create thumbnails, extract audio. Requires ffmpeg for most operations.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["info", "extract_frames", "thumbnail", "extract_audio", "list"],
          description: "Operation to perform on the video"
        },
        path: {
          type: "string",
          description: "Path to video file or directory"
        },
        interval: {
          type: "number",
          description: "Seconds between frames for frame extraction"
        },
        count: {
          type: "number",
          description: "Number of frames to extract"
        },
        timestamps: {
          type: "array",
          items: { type: "number" },
          description: "Specific timestamps (in seconds) to extract frames from"
        },
        output_dir: {
          type: "string",
          description: "Output directory for extracted content"
        }
      },
      required: ["operation", "path"]
    }
  }
};

// Hermes Video Analyze Tool - Analyze a video via a video-capable model
export const VIDEO_ANALYZE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "video_analyze",
    description: "Analyze a video from a URL or local file path using a configured video-capable model. Supports mp4, webm, mov, avi, mkv, mpeg, and mpg.",
    parameters: {
      type: "object",
      properties: {
        video_url: {
          type: "string",
          description: "HTTP/HTTPS URL, file:// URL, or local file path to analyze"
        },
        question: {
          type: "string",
          description: "Specific question to answer about the video after describing the scene"
        }
      },
      required: ["video_url", "question"]
    }
  }
};

// Video Understanding Tool - transcript-first comprehension of a YouTube/URL/local video
export const UNDERSTAND_VIDEO_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "understand_video",
    description: "Understand a video, local-first and $0. By default produces a timestamped transcript of what is SAID (YouTube captions → yt-dlp audio + local Whisper → local file). Set visual:true to ALSO analyze what is SHOWN on screen (samples keyframes, dedups near-identical ones, describes each with a local vision model, fuses one keyframe per transcript segment into {said, shown} tuples) — ideal for code screencasts; set ocr:true to also read on-screen code/text with OCR. Set cloud:true (OPT-IN) to also send the video/URL to Gemini for a joint audio+visual timestamped answer — this sends data to Google (public/non-sensitive videos only) and degrades to the local transcript if unavailable. Returns the structured transcript and persists it to .codebuddy/video/.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "YouTube URL (youtube.com/watch?v=… or youtu.be/…), a direct media URL, or a local video/audio file path"
        },
        question: {
          type: "string",
          description: "Optional question to answer about the video; recorded with the transcript so you can answer it from the transcript"
        },
        language: {
          type: "string",
          description: "Optional preferred caption/transcription language code (e.g. 'en', 'fr'). Tried first, then en/fr."
        },
        visual: {
          type: "boolean",
          description: "Also analyze what is SHOWN on screen (frames → local vision model), fused per transcript segment. EXPENSIVE and SLOW: it downloads the picture track then describes each keyframe at a local VLM (~1–10 s/frame). Recommended mainly for SHORT videos, or when the on-screen VISUAL content matters (code screencasts, diagrams, slides). For LONG videos prefer the default transcript-only path. Safe either way — the visual leg is wall-clock-bounded (CODEBUDDY_VIDEO_VISUAL_BUDGET_MS, default ~120 s) and degrades gracefully: on a long video it renders the transcript plus a partial/ignored-visual note instead of timing out. Default false (transcript only)."
        },
        ocr: {
          type: "boolean",
          description: "With visual:true, also OCR each keyframe (best for reading code/text on screen). Default false."
        },
        cloud: {
          type: "boolean",
          description: "OPT-IN cloud fallback: also send the video/URL to Gemini for a joint audio+visual, timestamped answer. Sends data to Google — public/non-sensitive videos only. Requires GEMINI_API_KEY; degrades to the local transcript on any failure. Default false."
        }
      },
      required: ["source"]
    }
  }
};

// Hermes Video Generation Tool - Generate videos through the configured backend
export const VIDEO_GENERATE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "video_generate",
    description: "Generate a video from a text prompt or animate an image through the configured video backend. Pass image_url for image-to-video.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text instruction describing the desired video, motion, style, and camera movement"
        },
        image_url: {
          type: "string",
          description: "Optional public image URL. When provided, the backend routes to image-to-video."
        },
        reference_image_urls: {
          type: "array",
          items: { type: "string" },
          description: "Optional reference image URLs for supported backends"
        },
        duration: {
          type: "number",
          description: "Desired duration in seconds. Providers clamp to supported ranges."
        },
        aspect_ratio: {
          type: "string",
          enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
          description: "Output aspect ratio. Defaults to 16:9."
        },
        resolution: {
          type: "string",
          enum: ["360p", "480p", "540p", "720p", "1080p", "4k"],
          description: "Output resolution. Defaults to 720p."
        },
        negative_prompt: {
          type: "string",
          description: "Optional negative prompt for providers that support it"
        },
        audio: {
          type: "boolean",
          description: "Optional native audio generation toggle for supported providers"
        },
        seed: {
          type: "number",
          description: "Optional seed for reproducible generations"
        },
        model: {
          type: "string",
          description: "Optional configured model/family override for the active backend"
        }
      },
      required: ["prompt"]
    }
  }
};

// Video Stitch Tool - Chain multiple clips into ONE longer film with transitions
export const VIDEO_STITCH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "video_stitch",
    description: "Chain (montage) multiple local video clips into ONE longer film with transitions, then optionally lay a looped background-music track (auto-ducked under dialogue) and a voiceover over the whole thing. This is how you turn the short clips produced by video_generate (they land in .codebuddy/media-generation/videos/) into a coherent long-form video. Uses ffmpeg (must be installed). Normalizes every clip to a common resolution/fps first, then welds them with the native ffmpeg xfade+acrossfade filters (engine 'xfade', ~50 transitions, default) or the gl-transition filter when present (engine 'gl', falls back to xfade otherwise). The result is saved under .codebuddy/media-generation/films/ and returned as a MEDIA:<path>.",
    parameters: {
      type: "object",
      properties: {
        clips: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of local video file paths to weld together, in play order. At least one; two or more to actually chain."
        },
        transition: {
          type: "string",
          description: "A single transition name applied at EVERY boundary (fade, fadeblack, dissolve, wipeleft/right/up/down, slideleft/right/up/down, circleopen/close, radial, pixelize, smoothleft…, or 'cut' for a hard cut). Default 'fade'."
        },
        transitions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "Transition name (see `transition`) or 'cut'." },
              duration: { type: "number", description: "This boundary's transition duration in seconds." }
            }
          },
          description: "Optional per-boundary transitions (one object per gap between adjacent clips), overriding `transition`. Length should be clips.length − 1."
        },
        transition_duration: {
          type: "number",
          description: "Default transition duration in seconds applied to every boundary that does not specify its own. Default 1. Auto-clamped to fit inside the shortest adjacent clip."
        },
        engine: {
          type: "string",
          enum: ["xfade", "gl"],
          description: "Transition engine. 'xfade' (default) = native ffmpeg filters, zero dependency. 'gl' = GLSL gl-transition filter if this ffmpeg has it, else it falls back to xfade with a warning."
        },
        resolution: {
          type: "string",
          description: "Output resolution as a preset ('360p','480p','540p','720p','1080p','1440p','2160p','4k') or explicit 'WIDTHxHEIGHT'. Defaults to the first clip's dimensions."
        },
        aspect_ratio: {
          type: "string",
          enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
          description: "Aspect ratio used with a resolution preset to compute the target dimensions. Default 16:9."
        },
        fps: {
          type: "number",
          description: "Output frame rate. Defaults to the first clip's fps, else 30."
        },
        music: {
          type: "string",
          description: "Optional background music file path. Looped and trimmed to the film length, and ducked under dialogue/voiceover unless ducking:false."
        },
        music_volume: {
          type: "number",
          description: "Background music volume 0..1. Default 0.25."
        },
        ducking: {
          type: "boolean",
          description: "Duck (lower) the music while dialogue/voiceover plays. Default true when music is present."
        },
        voiceover: {
          type: "string",
          description: "Optional full-length narration/voiceover audio file path, mixed at full volume over the film."
        },
        name: {
          type: "string",
          description: "Optional film name, used for the output filename and its sidecar metadata."
        },
        output: {
          type: "string",
          description: "Optional explicit output path. Defaults to .codebuddy/media-generation/films/<name>-<id>.mp4."
        }
      },
      required: ["clips"]
    }
  }
};

// Screenshot Tool - Capture screenshots
export const SCREENSHOT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "screenshot",
    description: "Capture screenshots of the screen, a window, or a region. Supports LLM-optimized output. Works on Linux, macOS, and Windows.",
    parameters: {
      type: "object",
      properties: {
        fullscreen: {
          type: "boolean",
          description: "Capture entire screen (default: true)"
        },
        window: {
          type: "string",
          description: "Window title or ID to capture"
        },
        region: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" }
          },
          description: "Screen region to capture"
        },
        delay: {
          type: "number",
          description: "Delay in seconds before capture"
        },
        format: {
          type: "string",
          enum: ["png", "jpg"],
          description: "Image format (default: png)"
        },
        quality: {
          type: "number",
          description: "JPEG quality 1-100 (only for jpg format)"
        },
        outputPath: {
          type: "string",
          description: "Custom output file path"
        },
        forLLM: {
          type: "boolean",
          description: "Normalize screenshot for LLM consumption (resize + compress)"
        }
      },
      required: []
    }
  }
};

// Camera Snapshot Tool - Capture a local webcam frame
export const CAMERA_SNAPSHOT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "camera_snapshot",
    description: "Capture one local webcam frame to an image file for Buddy companion vision and record a local vision percept. Requires ffmpeg and OS camera permission.",
    parameters: {
      type: "object",
      properties: {
        output_path: {
          type: "string",
          description: "Optional output image path. Defaults to .codebuddy/camera/camera-<timestamp>.png in the active workspace."
        },
        device: {
          type: "string",
          description: "Optional ffmpeg camera device. Windows example: video=Integrated Camera; macOS example: 0; Linux example: /dev/video0."
        },
        timeout_ms: {
          type: "number",
          description: "Capture timeout in milliseconds (default: 10000)."
        }
      },
      required: []
    }
  }
};

// Camera Analyze Tool - Capture a webcam frame AND describe it with a vision model
export const CAMERA_ANALYZE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "camera_analyze",
    description: "Capture one local webcam frame and return a natural-language description from a local multimodal vision model (default Ollama gemma4:12b). Use this to actually SEE what the camera shows, not just save a PNG. Requires ffmpeg, OS camera permission, and a reachable local vision model.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "What to ask the vision model about the frame. Default \"Describe what you see.\""
        },
        device: {
          type: "string",
          description: "Optional ffmpeg camera device. Linux example: /dev/video0; Windows: video=Integrated Camera; macOS: 0."
        },
        model: {
          type: "string",
          description: "Local multimodal model id served by Ollama. Default gemma4:12b."
        },
        include_ocr: {
          type: "boolean",
          description: "Also attach local OCR text evidence from the captured frame (default: false)."
        },
        ocr_language: {
          type: "string",
          description: "OCR language code when include_ocr is true (default: eng)."
        },
        output_path: {
          type: "string",
          description: "Optional output image path. Defaults to .codebuddy/camera/camera-<timestamp>.png in the active workspace."
        },
        timeout_ms: {
          type: "number",
          description: "Capture timeout in milliseconds (default: 10000)."
        }
      },
      required: []
    }
  }
};

// Clipboard Tool - System clipboard operations
export const CLIPBOARD_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "clipboard",
    description: "Read and write to system clipboard. Supports text, images, and HTML content.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["read_text", "write_text", "read_image", "write_image", "read_html", "copy_file_path", "copy_file_content", "get_type", "clear"],
          description: "Clipboard operation to perform"
        },
        text: {
          type: "string",
          description: "Text to write to clipboard (for write_text)"
        },
        path: {
          type: "string",
          description: "File path (for image operations or copy_file_*)"
        }
      },
      required: ["operation"]
    }
  }
};

// Document Tool - Read Office documents
export const DOCUMENT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "document",
    description: "Read Office documents (DOCX, XLSX, PPTX, CSV, RTF). Extracts text, metadata, structure, and DOCX embedded images with Markdown references for OCR-to-deliverable workflows.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["read", "list", "extract_images"],
          description: "Operation: read (extract content), list (list documents in directory), extract_images (save embedded DOCX images to a directory and return Markdown image references)"
        },
        path: {
          type: "string",
          description: "Path to document or directory"
        },
        output_dir: {
          type: "string",
          description: "Directory where embedded DOCX images should be extracted when operation is extract_images; results include output paths and Markdown references for generate_document"
        }
      },
      required: ["operation", "path"]
    }
  }
};

// OCR Tool - Extract text from images
export const OCR_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "ocr",
    description: "Extract text from images using OCR. Uses Tesseract if available, or vision API as fallback.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["extract", "extract_region", "list_languages", "batch"],
          description: "OCR operation to perform"
        },
        path: {
          type: "string",
          description: "Path to image file"
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Array of image paths for batch OCR"
        },
        language: {
          type: "string",
          description: "OCR language code (e.g., 'eng', 'fra', 'deu')"
        },
        region: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" }
          },
          description: "Region to OCR (for extract_region)"
        }
      },
      required: ["operation"]
    }
  }
};

// Hermes Vision Analyze Tool - one-shot local image inspection
export const VISION_ANALYZE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "vision_analyze",
    description: "Analyze a local image with real metadata, dominant color, labels, and optional local OCR evidence.",
    parameters: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "Absolute or workspace-relative path to the image file"
        },
        include_ocr: {
          type: "boolean",
          description: "Attempt local OCR and include text or OCR errors in the report (default: false)"
        },
        ocr_language: {
          type: "string",
          description: "OCR language code when include_ocr is true (default: eng)"
        }
      },
      required: ["image_path"]
    }
  }
};

// YOLOv8 Object Detection Tool - local object detection from image files
export const OBJECT_DETECT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "object_detect",
    description: "Detect objects in a local image using a local YOLOv8/Ultralytics Python runtime. For webcam use, first call camera_snapshot, then pass the captured image path here.",
    parameters: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "Absolute or workspace-relative path to the image file"
        },
        model_path: {
          type: "string",
          description: "Optional YOLO model path. Defaults to CODEBUDDY_YOLO_MODEL, ~/vision_tests/yolov8n.onnx, ~/vision_tests/yolov8n.pt, or yolov8n.pt"
        },
        python_path: {
          type: "string",
          description: "Optional Python executable with ultralytics installed. Defaults to CODEBUDDY_YOLO_PYTHON, ~/vision_tests/venv/bin/python, or python3"
        },
        min_confidence: {
          type: "number",
          description: "Minimum detection confidence from 0 to 1. Default 0.25"
        },
        iou_threshold: {
          type: "number",
          description: "YOLO IoU threshold from 0 to 1. Default 0.7"
        },
        classes: {
          type: "array",
          items: { type: "string" },
          description: "Optional class names or numeric class IDs to keep, e.g. [\"person\"] or [\"0\"]"
        },
        device: {
          type: "string",
          description: "Optional Ultralytics device, e.g. cpu, cuda:0, mps, or a ROCm-supported device string"
        },
        max_detections: {
          type: "number",
          description: "Maximum detections to return. Default 100"
        },
        save_annotated: {
          type: "boolean",
          description: "Also save an annotated image with boxes. Default false"
        },
        annotated_output_path: {
          type: "string",
          description: "Optional output path for the annotated image when save_annotated is true"
        },
        timeout_ms: {
          type: "number",
          description: "YOLO runtime timeout in milliseconds. Default 120000"
        }
      },
      required: ["image_path"]
    }
  }
};

// Diagram Tool - Generate diagrams
export const DIAGRAM_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "diagram",
    description: "Generate diagrams: flowcharts, sequence diagrams, class diagrams, pie charts, Gantt charts, and ASCII art.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["mermaid", "flowchart", "sequence", "class", "pie", "gantt", "ascii_box", "ascii_tree", "list"],
          description: "Type of diagram to generate"
        },
        code: {
          type: "string",
          description: "Mermaid code for mermaid operation"
        },
        title: {
          type: "string",
          description: "Title for the diagram"
        },
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: { type: "string", enum: ["default", "round", "diamond", "stadium"] }
            },
            required: ["id", "label"]
          },
          description: "Nodes for flowchart or ASCII tree"
        },
        connections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" },
              type: { type: "string", enum: ["arrow", "dotted", "thick"] }
            },
            required: ["from", "to"]
          },
          description: "Connections between nodes"
        },
        participants: {
          type: "array",
          items: { type: "string" },
          description: "Participants for sequence diagram"
        },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              message: { type: "string" },
              type: { type: "string", enum: ["sync", "async", "reply"] }
            },
            required: ["from", "to", "message"]
          },
          description: "Messages for sequence diagram"
        },
        classes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              attributes: { type: "array", items: { type: "string" } },
              methods: { type: "array", items: { type: "string" } }
            },
            required: ["name"]
          },
          description: "Classes for class diagram"
        },
        relationships: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              type: { type: "string", enum: ["inheritance", "composition", "aggregation", "association", "dependency"] },
              label: { type: "string" }
            },
            required: ["from", "to", "type"]
          },
          description: "Relationships for class diagram"
        },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" }
            },
            required: ["label", "value"]
          },
          description: "Data points for pie chart"
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    id: { type: "string" },
                    start: { type: "string" },
                    duration: { type: "string" },
                    status: { type: "string", enum: ["done", "active", "crit"] }
                  },
                  required: ["name", "id", "start", "duration"]
                }
              }
            },
            required: ["name", "tasks"]
          },
          description: "Sections for Gantt chart"
        },
        format: {
          type: "string",
          enum: ["svg", "png", "ascii", "utf8"],
          description: "Output format (default: ascii)"
        }
      },
      required: ["operation"]
    }
  }
};

// Export Tool - Export conversations and data
export const EXPORT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "export",
    description: "Export conversations to various formats: JSON, Markdown, HTML, plain text, or PDF.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["conversation", "csv", "code_snippets", "list"],
          description: "Export operation"
        },
        format: {
          type: "string",
          enum: ["json", "markdown", "html", "txt", "pdf"],
          description: "Export format for conversation"
        },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              content: { type: "string" },
              timestamp: { type: "string" }
            }
          },
          description: "Messages to export"
        },
        data: {
          type: "array",
          items: {
            type: "object"
          },
          description: "Data array for CSV export"
        },
        title: {
          type: "string",
          description: "Title for the export"
        },
        include_metadata: {
          type: "boolean",
          description: "Include metadata in export"
        },
        include_timestamps: {
          type: "boolean",
          description: "Include timestamps in export"
        },
        theme: {
          type: "string",
          enum: ["light", "dark"],
          description: "Theme for HTML export"
        },
        output_path: {
          type: "string",
          description: "Output file path"
        }
      },
      required: ["operation"]
    }
  }
};

// QR Tool - Generate and read QR codes
export const QR_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "qr",
    description: "Generate and read QR codes. Supports URL, WiFi, vCard, and custom data. Can output ASCII, SVG, or PNG.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["generate", "generate_url", "generate_wifi", "generate_vcard", "decode", "list"],
          description: "QR code operation"
        },
        data: {
          type: "string",
          description: "Data to encode in QR code"
        },
        url: {
          type: "string",
          description: "URL for generate_url"
        },
        ssid: {
          type: "string",
          description: "WiFi SSID for generate_wifi"
        },
        password: {
          type: "string",
          description: "WiFi password for generate_wifi"
        },
        wifi_type: {
          type: "string",
          enum: ["WPA", "WEP", "nopass"],
          description: "WiFi security type"
        },
        contact: {
          type: "object",
          description: "Contact info for vCard (firstName, lastName, phone, email, etc.)"
        },
        path: {
          type: "string",
          description: "Path to QR code image for decode"
        },
        format: {
          type: "string",
          enum: ["ascii", "utf8", "svg", "png"],
          description: "Output format (default: utf8)"
        }
      },
      required: ["operation"]
    }
  }
};

// Archive Tool - Work with compressed archives
export const ARCHIVE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "archive",
    description: "Work with compressed archives: ZIP, TAR, TAR.GZ, 7Z, RAR. List, extract, and create archives.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["list", "extract", "create", "list_archives"],
          description: "Archive operation to perform"
        },
        path: {
          type: "string",
          description: "Path to archive file or directory"
        },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Source paths for creating archive"
        },
        output_dir: {
          type: "string",
          description: "Output directory for extraction"
        },
        output_path: {
          type: "string",
          description: "Output path for created archive"
        },
        format: {
          type: "string",
          enum: ["zip", "tar", "tar.gz", "tar.bz2", "tar.xz"],
          description: "Format for creating archive (default: zip)"
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Specific files to extract"
        },
        password: {
          type: "string",
          description: "Password for encrypted archives"
        },
        overwrite: {
          type: "boolean",
          description: "Overwrite existing files during extraction"
        }
      },
      required: ["operation"]
    }
  }
};

/**
 * All multimodal tools as an array
 */
export const MULTIMODAL_TOOLS: CodeBuddyTool[] = [
  PDF_TOOL,
  AUDIO_TOOL,
  TEXT_TO_SPEECH_TOOL,
  IMAGE_GENERATE_TOOL,
  VIDEO_TOOL,
  VIDEO_ANALYZE_TOOL,
  UNDERSTAND_VIDEO_TOOL,
  VIDEO_GENERATE_TOOL,
  VIDEO_STITCH_TOOL,
  SCREENSHOT_TOOL,
  CAMERA_SNAPSHOT_TOOL,
  CAMERA_ANALYZE_TOOL,
  CLIPBOARD_TOOL,
  DOCUMENT_TOOL,
  OCR_TOOL,
  VISION_ANALYZE_TOOL,
  OBJECT_DETECT_TOOL,
  DIAGRAM_TOOL,
  EXPORT_TOOL,
  QR_TOOL,
  ARCHIVE_TOOL,
];
