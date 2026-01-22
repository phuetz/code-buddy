/**
 * Neovim Plugin Generator
 *
 * Generates Neovim Lua plugin code for IDE integration.
 */

import type { IDEExtensionsConfig } from './types.js';

/**
 * Generate Neovim plugin Lua code.
 */
export function generateNeovimPlugin(config: IDEExtensionsConfig): string {
  return `
-- CodeBuddy AI integration for Neovim
-- Add to your init.lua or lazy.nvim config

local M = {}

M.config = {
  port = ${config.port},
  host = '127.0.0.1',
  auto_connect = true,
}

local client = nil
local request_id = 0
local pending_requests = {}

-- Connect to Grok server
function M.connect()
  local uv = vim.loop
  client = uv.new_tcp()

  client:connect(M.config.host, M.config.port, function(err)
    if err then
      vim.schedule(function()
        vim.notify('Code Buddy: Connection failed - ' .. err, vim.log.levels.WARN)
      end)
      return
    end

    -- Send initialization
    M.send_request('initialize', {
      ide = 'neovim',
      version = vim.version().major .. '.' .. vim.version().minor,
    })

    -- Start reading
    client:read_start(function(err, data)
      if err then
        vim.schedule(function()
          vim.notify('Code Buddy: Read error - ' .. err, vim.log.levels.ERROR)
        end)
        return
      end

      if data then
        vim.schedule(function()
          M.handle_response(data)
        end)
      end
    end)
  end)
end

-- Send request to server
function M.send_request(method, params, callback)
  if not client then
    if callback then callback(nil, 'Not connected') end
    return
  end

  request_id = request_id + 1
  local id = tostring(request_id)

  if callback then
    pending_requests[id] = callback
  end

  local message = vim.json.encode({
    id = id,
    method = method,
    params = params,
  }) .. '\\n'

  client:write(message)
end

-- Handle server response
function M.handle_response(data)
  for line in data:gmatch('[^\\n]+') do
    local ok, response = pcall(vim.json.decode, line)
    if ok and response.id then
      local callback = pending_requests[response.id]
      pending_requests[response.id] = nil

      if callback then
        if response.error then
          callback(nil, response.error.message)
        else
          callback(response.result, nil)
        end
      end
    end
  end
end

-- Ask AI a question
function M.ask(question)
  M.send_request('ask', { question = question }, function(result, err)
    if err then
      vim.notify('Code Buddy: ' .. err, vim.log.levels.ERROR)
      return
    end

    -- Show in floating window
    local buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, vim.split(result.answer, '\\n'))

    local width = math.min(80, vim.o.columns - 4)
    local height = math.min(20, vim.o.lines - 4)

    vim.api.nvim_open_win(buf, true, {
      relative = 'editor',
      width = width,
      height = height,
      col = (vim.o.columns - width) / 2,
      row = (vim.o.lines - height) / 2,
      style = 'minimal',
      border = 'rounded',
    })
  end)
end

-- Explain selected code
function M.explain()
  local start_line = vim.fn.line("'<")
  local end_line = vim.fn.line("'>")
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  local code = table.concat(lines, '\\n')

  M.send_request('explain', {
    code = code,
    language = vim.bo.filetype,
  }, function(result, err)
    if err then
      vim.notify('Code Buddy: ' .. err, vim.log.levels.ERROR)
      return
    end

    vim.notify(result.explanation, vim.log.levels.INFO)
  end)
end

-- Refactor selected code
function M.refactor(instruction)
  local start_line = vim.fn.line("'<")
  local end_line = vim.fn.line("'>")
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  local code = table.concat(lines, '\\n')

  M.send_request('refactor', {
    code = code,
    instruction = instruction,
    language = vim.bo.filetype,
  }, function(result, err)
    if err then
      vim.notify('Code Buddy: ' .. err, vim.log.levels.ERROR)
      return
    end

    if result.refactored then
      local new_lines = vim.split(result.refactored, '\\n')
      vim.api.nvim_buf_set_lines(0, start_line - 1, end_line, false, new_lines)
    end
  end)
end

-- Setup keymaps
function M.setup(opts)
  M.config = vim.tbl_deep_extend('force', M.config, opts or {})

  -- Commands
  vim.api.nvim_create_user_command('CodeBuddyAsk', function(args)
    M.ask(args.args)
  end, { nargs = '+' })

  vim.api.nvim_create_user_command('CodeBuddyExplain', function()
    M.explain()
  end, { range = true })

  vim.api.nvim_create_user_command('CodeBuddyRefactor', function(args)
    M.refactor(args.args)
  end, { range = true, nargs = '+' })

  -- Keymaps
  vim.keymap.set('n', '<leader>ga', ':CodeBuddyAsk ', { desc = 'Code Buddy: Ask AI' })
  vim.keymap.set('v', '<leader>ge', ':CodeBuddyExplain<CR>', { desc = 'Code Buddy: Explain' })
  vim.keymap.set('v', '<leader>gr', ':CodeBuddyRefactor ', { desc = 'Code Buddy: Refactor' })

  -- Auto-connect
  if M.config.auto_connect then
    M.connect()
  end
end

return M
`;
}
