(() => {
  const copyButton = document.querySelector('[data-copy]');
  const status = document.querySelector('.copy-status');

  if (!copyButton || !status) return;

  copyButton.addEventListener('click', async () => {
    const command = copyButton.dataset.copy;
    if (!command) return;

    try {
      await navigator.clipboard.writeText(command);
      status.textContent = 'Copied — paste it into your terminal.';
      copyButton.querySelector('.copy-label').textContent = 'Copied';
      window.setTimeout(() => {
        status.textContent = '';
        copyButton.querySelector('.copy-label').textContent = 'Copy';
      }, 2400);
    } catch {
      status.textContent = `Copy this command: ${command}`;
    }
  });
})();
