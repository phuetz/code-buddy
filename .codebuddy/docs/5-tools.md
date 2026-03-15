# Tool System

The project uses a dual-registry tool architecture with RAG-based selection. Tools are organized by category and selected per-query based on semantic relevance.

## Tool Registry

The tool ecosystem contains **117** tool modules organized in `src/tools/` and `src/tools/registry/`.

## Tool Categories

| Category | Tools | Count |
|----------|-------|-------|
| system | `process`, `js_repl`, `git`, `kubernetes` +5 | 9 |
| file_search | `find_symbols`, `find_references`, `find_definition`, `search_multi` +2 | 6 |
| file_write | `str_replace_editor`, `edit_file`, `multi_edit`, `list_directory` +1 | 5 |
| file_read | `create_file`, `search`, `view_file`, `list_directory` | 4 |
| web | `web_fetch`, `browser`, `computer_control`, `web_search` | 4 |
| planning | `get_todo_list`, `update_todo_list`, `codebase_map`, `create_todo_list` | 4 |
| codebase | `code_graph`, `spawn_subagent`, `codebase_map` | 3 |
| git | `docker`, `git` | 2 |

## RAG-Based Tool Selection

Each user query triggers a semantic similarity search over tool metadata:

1. **Query embedding** — User message converted to vector
2. **Similarity scoring** — Each tool scored against query (0-1)
3. **Top-K selection** — ~15-20 most relevant tools selected
4. **Token savings** — Reduces prompt from 110+ tools to ~15-20

Tools have priority (3-10), keywords, and category metadata used for matching.

## Registered Tools

27 tools registered in metadata:

- **bash**: bash
- **browser**: browser
- **code**: code_graph
- **codebase**: codebase_map
- **computer**: computer_control
- **create**: create_file, create_todo_list
- **docker**: docker
- **edit**: edit_file
- **find**: find_symbols, find_references, find_definition
- **get**: get_todo_list
- **git**: git
- **js**: js_repl
- **kubernetes**: kubernetes
- **list**: list_directory
- **multi**: multi_edit
- **process**: process
- **search**: search, search_multi
- **spawn**: spawn_subagent
- **str**: str_replace_editor
- **update**: update_todo_list
- **view**: view_file
- **web**: web_search, web_fetch