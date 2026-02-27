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
    description: "Read Office documents (DOCX, XLSX, PPTX, CSV, RTF). Extracts text, metadata, and structure.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["read", "list"],
          description: "Operation: read (extract content), list (list documents in directory)"
        },
        path: {
          type: "string",
          description: "Path to document or directory"
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
  VIDEO_TOOL,
  SCREENSHOT_TOOL,
  CLIPBOARD_TOOL,
  DOCUMENT_TOOL,
  OCR_TOOL,
  DIAGRAM_TOOL,
  EXPORT_TOOL,
  QR_TOOL,
  ARCHIVE_TOOL,
];
