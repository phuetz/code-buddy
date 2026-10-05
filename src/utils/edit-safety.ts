/**
 * Garde-fous communs aux outils d'édition textuelle (str_replace, multi_edit,
 * replace_lines, insert, apply_patch).
 *
 * Trois corruptions silencieuses sont fermées ici :
 *  - un fichier qui n'est pas du texte UTF-8 (binaire, latin-1, UTF-16) lu en
 *    « utf-8 » devient U+FFFD à la réécriture : on le refuse AVANT de lire ;
 *  - une fin de ligne CRLF perdue ou mélangée avec du LF ;
 *  - (voir multi-strategy-match.ts pour la correspondance unicode).
 */

/** Sous-ensemble du routeur VFS dont on a besoin (permet les doublures de test). */
export interface EditableTextSource {
  readFile(filePath: string, encoding?: string): Promise<string>;
  readFileBuffer?(filePath: string): Promise<Buffer>;
}

export type EditableTextResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export function binaryRefusalMessage(displayPath: string): string {
  return (
    `Édition textuelle refusée : ${displayPath} n'est pas un fichier texte UTF-8 ` +
    `(contenu binaire, octet NUL ou autre encodage). Le fichier n'a pas été modifié ; ` +
    `une réécriture textuelle y remplacerait des octets par U+FFFD.`
  );
}

/**
 * Décode des octets en texte UTF-8 STRICT : `null` si le contenu n'est pas du
 * texte (UTF-8 invalide ou octet NUL). Le BOM est conservé dans le texte.
 */
export function decodeStrictUtf8(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Lit un fichier à éditer : texte UTF-8 valide ou refus explicite. */
export async function readEditableText(
  vfs: EditableTextSource,
  resolvedPath: string,
  displayPath: string,
): Promise<EditableTextResult> {
  if (typeof vfs.readFileBuffer !== 'function') {
    // Routeur sans lecture binaire (doublure) : comportement historique.
    return { ok: true, text: await vfs.readFile(resolvedPath, 'utf-8') };
  }
  const text = decodeStrictUtf8(await vfs.readFileBuffer(resolvedPath));
  if (text === null) return { ok: false, error: binaryRefusalMessage(displayPath) };
  return { ok: true, text };
}

/** Vrai si le texte utilise CRLF (au moins un, et au moins autant que de LF seuls). */
export function usesCrlf(text: string): boolean {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > 0 && crlf >= lf;
}

/**
 * Aligne les fins de ligne d'un texte de remplacement sur la zone remplacée.
 * Le LLM écrit en LF : dans un fichier CRLF, ses sauts de ligne doivent
 * devenir CRLF, sinon le fichier se retrouve mélangé. Un texte qui contient
 * déjà un `\r` est considéré comme voulu tel quel.
 */
export function adaptNewStrEol(newStr: string, matched: string, fileContent: string): string {
  if (!newStr.includes('\n') || newStr.includes('\r')) return newStr;
  const crlf = matched.includes('\r\n')
    ? true
    : matched.includes('\n')
      ? false
      : usesCrlf(fileContent);
  return crlf ? newStr.replace(/\n/g, '\r\n') : newStr;
}
