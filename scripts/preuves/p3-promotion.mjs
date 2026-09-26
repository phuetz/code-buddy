// Attend les deux effets persistés du rêve avant d'arrêter le serveur de preuve.
export async function waitForDreamPromotion({
  readJournal,
  readMemory,
  serverAlive,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 30000,
}) {
  const deadline = Date.now() + timeoutMs;
  let journalText = '';
  let memoryText = '';
  while (Date.now() < deadline) {
    journalText = await readJournal();
    memoryText = await readMemory();
    if (journalText.includes('audio/speech_end') && memoryText.includes('dream:recent')) break;
    if (!serverAlive()) break;
    await sleep(100);
  }
  return { journalText, memoryText };
}
