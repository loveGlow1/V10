/* Each project keeps its own colour, picked from its id so it is the same on
   every device, after every reload, and wherever the project is drawn. */
const AVATARS = [
  "from-[#F06FC0] to-[#34F5A0]",
  "from-[#34F5A0] to-[#2FD3D3]",
  "from-[#6C8BFF] to-[#B06CFF]",
  "from-[#FFB86C] to-[#F06FC0]",
  "from-[#2FD3D3] to-[#6C8BFF]",
];

export function avatarFor(id: string | undefined) {
  if (!id) return AVATARS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}
