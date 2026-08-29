/** Masks an address for display: the first character and the domain, which is
    enough for the owner to recognise their own account, with a fixed run of dots
    in between so the length of the local part is not published either.

    Shown wherever the signed-in person is named — the drawer's account panel and
    the settings modal — so it lives here rather than in either of them: two
    copies would let one screen mask an address the other spells out. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}
