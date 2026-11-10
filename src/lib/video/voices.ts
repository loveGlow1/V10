/* The voices a voice-over can be read in — MiniMax's system voices, the same
 * ids on Runware (minimax:speech@2.8) and on MiniMax's own API. A curated
 * set: clear in English, plus the main languages the studio is used in.
 * Pure: the editor's voice picker and the server's checks both read it. */

export type Voice = { id: string; label: string; language: string };

export const VOICES: Voice[] = [
  { id: "English_Graceful_Lady", label: "Graceful lady", language: "English" },
  { id: "English_Trustworth_Man", label: "Trustworthy man", language: "English" },
  { id: "English_expressive_narrator", label: "Expressive narrator", language: "English" },
  { id: "English_CaptivatingStoryteller", label: "Storyteller", language: "English" },
  { id: "English_radiant_girl", label: "Radiant girl", language: "English" },
  { id: "English_Upbeat_Woman", label: "Upbeat woman", language: "English" },
  { id: "English_ConfidentWoman", label: "Confident woman", language: "English" },
  { id: "English_CalmWoman", label: "Calm woman", language: "English" },
  { id: "English_magnetic_voiced_man", label: "Magnetic man", language: "English" },
  { id: "English_Deep-VoicedGentleman", label: "Deep-voiced gentleman", language: "English" },
  { id: "English_ManWithDeepVoice", label: "Deep voice", language: "English" },
  { id: "English_FriendlyPerson", label: "Friendly", language: "English" },
  { id: "English_DecentYoungMan", label: "Young man", language: "English" },
  { id: "English_PlayfulGirl", label: "Playful girl", language: "English" },
  { id: "English_Comedian", label: "Comedian", language: "English" },
  { id: "English_Whispering_girl", label: "Whisper", language: "English" },
  { id: "English_Aussie_Bloke", label: "Aussie bloke", language: "English" },
  { id: "English_WiseScholar", label: "Wise scholar", language: "English" },
  { id: "French_MaleNarrator", label: "Narrateur", language: "French" },
  { id: "French_FemaleAnchor", label: "Présentatrice", language: "French" },
  { id: "Spanish_Narrator", label: "Narrador", language: "Spanish" },
  { id: "Spanish_ConfidentWoman", label: "Mujer segura", language: "Spanish" },
  { id: "Portuguese_Narrator", label: "Narrador", language: "Portuguese" },
  { id: "Portuguese_ConfidentWoman", label: "Mulher confiante", language: "Portuguese" },
  { id: "German_FriendlyMan", label: "Freundlicher Mann", language: "German" },
  { id: "German_SweetLady", label: "Sanfte Dame", language: "German" },
  { id: "Arabic_CalmWoman", label: "Calm woman", language: "Arabic" },
  { id: "Arabic_FriendlyGuy", label: "Friendly guy", language: "Arabic" },
  { id: "hindi_female_1_v2", label: "Female", language: "Hindi" },
  { id: "hindi_male_1_v2", label: "Male", language: "Hindi" },
];

export const VOICE_IDS = new Set(VOICES.map((voice) => voice.id));
export const isVoiceId = (value: unknown): value is string => typeof value === "string" && VOICE_IDS.has(value);
export const voiceLabel = (id: string | undefined | null) => {
  const voice = VOICES.find((v) => v.id === id);
  return voice ? `${voice.label} (${voice.language})` : id ?? "";
};
