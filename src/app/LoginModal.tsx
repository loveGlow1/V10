"use client";

import { Apple, ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff, Github as GitHubIcon, KeyRound, Mail, Phone, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import countries from "world-countries";
import Q3DCanvas from "./Q3DCanvas";

type AuthStep = "options" | "email" | "phone" | "signin" | "otp";

type LoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onProviderAuth: (provider: string) => Promise<void> | void;
  onEmailSignUp: (payload: { name: string; email: string; password: string }) => Promise<void> | void;
  onEmailSignIn: (payload: { email: string; password: string }) => Promise<void> | void;
  /** Resolves true when the code was sent, which is what advances the modal to the otp step. */
  onPhoneContinue: (payload: { name: string; dialCode: string; phone: string }) => Promise<boolean>;
  onPhoneVerify: (payload: { dialCode: string; phone: string; token: string }) => Promise<boolean>;
  initialStep?: AuthStep;
};

type CountryOption = {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
};

export function GoogleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M21.805 10.023H12v4.037h5.623c-.533 2.562-2.718 4.037-5.623 4.037A6.096 6.096 0 0 1 5.908 12 6.096 6.096 0 0 1 12 5.903c1.642 0 3.12.62 4.255 1.635l2.858-2.858A9.933 9.933 0 0 0 12 1.75 10.25 10.25 0 0 0 1.75 12 10.25 10.25 0 0 0 12 22.25c5.918 0 10.07-4.158 10.07-10.019 0-.672-.09-1.286-.265-2.208Z"
        fill="#FFC107"
      />
      <path
        d="M2.93 7.227 6.246 9.66A6.097 6.097 0 0 1 12 5.903c1.642 0 3.12.62 4.255 1.635l2.858-2.858A9.933 9.933 0 0 0 12 1.75c-3.938 0-7.363 2.224-9.07 5.477Z"
        fill="#FF3D00"
      />
      <path
        d="M12 22.25a9.93 9.93 0 0 0 7-2.72l-3.226-2.728c-.907.694-2.124 1.295-3.774 1.295-2.894 0-5.072-1.456-5.614-4.003l-3.29 2.536A10.248 10.248 0 0 0 12 22.25Z"
        fill="#4CAF50"
      />
      <path
        d="M21.805 10.023H12v4.037h5.623c-.256 1.232-.947 2.156-1.849 2.844l.001-.001L19 19.625c1.905-1.756 3.07-4.348 3.07-7.394 0-.672-.09-1.286-.265-2.208Z"
        fill="#1976D2"
      />
    </svg>
  );
}

export function FacebookIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="10" fill="#1877F2" />
      <path
        d="M13.35 18v-5.47h1.84l.28-2.13h-2.12V9.04c0-.62.17-1.04 1.05-1.04h1.12V6.09c-.19-.03-.86-.09-1.63-.09-1.61 0-2.72.98-2.72 2.79v1.61H9.35v2.13h1.82V18h2.18Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function generateFlagEmoji(countryCode: string) {
  return String.fromCodePoint(...countryCode.toUpperCase().split("").map((char) => 127397 + char.charCodeAt(0)));
}

export const PROVIDER_ICON_CLASS = "h-5 w-5 shrink-0";

export function ProviderButton({
  provider,
  className,
  children,
  onProviderAuth,
  loadingLabel = "Pending…",
}: {
  provider: string;
  className: string;
  children: React.ReactNode;
  onProviderAuth: (provider: string) => Promise<void> | void;
  loadingLabel?: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await onProviderAuth(provider);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleClick} disabled={loading} className={className}>
      {loading ? (
        <>
          <span className="btn-spinner mr-2" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

const COUNTRY_OPTIONS: CountryOption[] = countries
  .map((country) => {
    const root = country.idd?.root ?? "";
    const suffix = country.idd?.suffixes?.[0] ?? "";
    if (!country.cca2 || !country.name?.common || !root || !suffix) return null;

    const dialCode = `${root}${suffix}`;
    const flag = country.flag || generateFlagEmoji(country.cca2);

    return {
      code: country.cca2,
      name: country.name.common,
      flag,
      dialCode,
    };
  })
  .filter((country): country is CountryOption => Boolean(country))
  .sort((a, b) => a.name.localeCompare(b.name));

export default function LoginModal({ isOpen, onClose, onProviderAuth, onEmailSignUp, onEmailSignIn, onPhoneContinue, onPhoneVerify, initialStep }: LoginModalProps) {
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [showSigninPassword, setShowSigninPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState("IN");
  const [otpCode, setOtpCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAuthStep(initialStep ?? "email");
    setCountryDropdownOpen(false);
    setCountryQuery("");
  }, [isOpen, initialStep]);

  const filteredCountries = useMemo(() => {
    const query = countryQuery.trim().toLowerCase();
    if (!query) return COUNTRY_OPTIONS;
    return COUNTRY_OPTIONS.filter((country) => country.name.toLowerCase().includes(query) || country.dialCode.includes(query));
  }, [countryQuery]);

  const selectedCountry = useMemo(() => COUNTRY_OPTIONS.find((country) => country.code === selectedCountryCode) ?? COUNTRY_OPTIONS[0], [selectedCountryCode]);

  if (!isOpen) return null;

  function handleClose() {
    setAuthStep("email");
    setCountryDropdownOpen(false);
    setCountryQuery("");
    setName("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setSigninEmail("");
    setSigninPassword("");
    setShowSigninPassword(false);
    setOtpCode("");
    onClose();
  }

  const logoEmblem = (
    <div className="flex justify-center">
      <div className="q-logo-backdrop h-28 w-28 sm:h-36 sm:w-36">
        <Q3DCanvas className="h-full w-full" scale={0.82} />
      </div>
    </div>
  );

  const heading = (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs font-semibold uppercase tracking-[0.2em]">
        <span className="wordmark-quickstart">QuickStart</span><span className="wordmark-ai">.Ai</span>
      </p>
      <h2 className="whitespace-nowrap text-center text-[clamp(1.2rem,5vw,2.4rem)] font-bold leading-[1.15] tracking-tight">
        <span className="metal-shimmer">Build Full-Stack</span>
      </h2>
    </div>
  );

  const accountPromptClass = "text-center text-sm text-white/50";
  const accountPromptLinkClass =
    "font-medium text-emerald-400 transition-colors hover:text-emerald-300";

  const signInSubtext = (
    <p className={accountPromptClass}>
      Already have an account?{" "}
      <button type="button" onClick={() => setAuthStep("signin")} className={accountPromptLinkClass}>
        Sign in
      </button>
    </p>
  );

  const signUpSubtext = (
    <p className={accountPromptClass}>
      Don&apos;t have an account?{" "}
      <button type="button" onClick={() => setAuthStep("email")} className={accountPromptLinkClass}>
        Sign up
      </button>
    </p>
  );

  // Every step composes its header the same way, so the account prompt always lands in the
  // same slot — directly under the headline — rather than above the emblem on one step and
  // below the headline on another.
  const brandingBlockWith = (subtext: React.ReactNode) => (
    <div className="mb-6 flex flex-col items-center gap-4 text-center sm:mb-7 sm:gap-5">
      {logoEmblem}
      {heading}
      {subtext}
    </div>
  );

  const brandingBlock = brandingBlockWith(signInSubtext);
  const brandingBlockSignUp = brandingBlockWith(signUpSubtext);

  // The link labels are kept whole — the max-width cap here used to be narrower than the
  // space the modal actually offers, which broke "Privacy Policy" across two lines. Letting
  // the sentence use the available width and balancing the wrap keeps it on one line at
  // normal widths and splits it evenly when it cannot.
  const footerLinkClass = "whitespace-nowrap underline underline-offset-4";
  const footerLinks = (
    <p className="mx-auto text-balance text-center text-[11px] leading-[1.55] text-white/45 sm:text-xs">
      By continuing, you agree to our{" "}
      <a href="#" className={footerLinkClass}>
        Terms of Service
      </a>{" "}
      /{" "}
      <a href="#" className={footerLinkClass}>
        Privacy Policy
      </a>
    </p>
  );

  const providerIconClass = PROVIDER_ICON_CLASS;
  const primaryProviderButtonClass =
    "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-emerald-50 disabled:opacity-60 sm:text-base";
  const compactProviderButtonClass =
    "flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-neutral-900/60 px-3 text-sm font-medium transition hover:border-emerald-500/30 disabled:opacity-60";
  const alternateMethodButtonClass =
    "flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-neutral-900/60 px-4 text-sm font-semibold transition hover:border-emerald-500/30 sm:h-12 sm:text-base";
  const inputWrapperClass =
    "flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/60 px-4 transition focus-within:ring-2 focus-within:ring-emerald-500/20";
  const inputFieldClass = "w-full bg-transparent text-base placeholder:text-white/40 outline-none";
  const primaryActionButtonClass =
    "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm sm:text-base font-semibold text-black tracking-tight transition hover:bg-emerald-50 disabled:opacity-60";
  const goBackButtonClass =
    "flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-neutral-900/60 text-sm sm:text-base font-semibold text-white transition hover:border-emerald-500/30";

  return (
    <div className="fixed inset-0 z-[10000] flex min-h-dvh w-full flex-col overflow-y-auto bg-black text-white">
      <button
        onClick={handleClose}
        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:border-white/40 hover:text-white"
        style={{ top: "max(1rem, env(safe-area-inset-top))" }}
        aria-label="Close and return to homepage"
      >
        ✕
      </button>

      <main
        className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-8"
        style={{
          paddingTop: "max(2rem, env(safe-area-inset-top))",
          paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
        }}
      >
            {authStep === "options" && (
              <div className="flex flex-col items-center text-center">
                {brandingBlock}

                <div className="w-full space-y-3">
                  <ProviderButton
                    provider="Google"
                    onProviderAuth={onProviderAuth}
                    className={primaryProviderButtonClass}
                  >
                    <GoogleIcon className={providerIconClass} />
                    Continue with Google
                  </ProviderButton>

                  <div className="grid grid-cols-3 gap-2.5">
                    <ProviderButton
                      provider="GitHub"
                      onProviderAuth={onProviderAuth}
                      className={compactProviderButtonClass}
                    >
                      <GitHubIcon className="h-5 w-5 shrink-0 text-emerald-400" />
                      <span>GitHub</span>
                    </ProviderButton>
                    <ProviderButton
                      provider="Apple"
                      onProviderAuth={onProviderAuth}
                      className={compactProviderButtonClass}
                    >
                      <Apple className={`${providerIconClass} text-white`} />
                      <span>Apple</span>
                    </ProviderButton>
                    <ProviderButton
                      provider="Facebook"
                      onProviderAuth={onProviderAuth}
                      className={compactProviderButtonClass}
                    >
                      <FacebookIcon className={providerIconClass} />
                      <span>Facebook</span>
                    </ProviderButton>
                  </div>

                  <div className="flex items-center gap-3 py-0.5">
                    <div className="flex-1 h-px bg-white/15" />
                    <span className="text-white/45 text-xs sm:text-sm font-medium tracking-widest">OR</span>
                    <div className="flex-1 h-px bg-white/15" />
                  </div>

                  <button
                    onClick={() => setAuthStep("email")}
                    className={alternateMethodButtonClass}
                  >
                    <Mail className={`${providerIconClass} text-white/80`} />
                    Continue with Email
                  </button>

                  <button
                    onClick={() => {
                      setAuthStep("phone");
                      setCountryDropdownOpen(false);
                    }}
                    className={alternateMethodButtonClass}
                  >
                    <Phone className={`${providerIconClass} text-white/80`} />
                    Continue with Phone
                  </button>
                </div>

                <div className="mt-5 w-full sm:mt-6">{footerLinks}</div>
              </div>
            )}

            {authStep === "email" && (
              <div>
                {brandingBlock}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await onEmailSignUp({ name, email, password });
                  }}
                  className="space-y-3"
                >
                  <div className={inputWrapperClass}>
                    <UserRound className="h-5 w-5 shrink-0 text-white/45" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your name"
                      className={inputFieldClass}
                    />
                  </div>

                  <div className={inputWrapperClass}>
                    <Mail className="h-5 w-5 shrink-0 text-white/45" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className={inputFieldClass}
                    />
                  </div>

                  <div className={inputWrapperClass}>
                    <KeyRound className="h-5 w-5 shrink-0 text-white/45" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className={inputFieldClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-white/45 hover:text-white/80 transition-colors shrink-0"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  <div className="space-y-3 pt-1">
                    <button type="submit" className={primaryActionButtonClass}>
                      Get Started <ArrowRight className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setAuthStep("options")} className={goBackButtonClass}>
                      <ArrowLeft className="h-4 w-4" /> Go Back
                    </button>
                  </div>
                </form>

                {footerLinks}
              </div>
            )}

            {authStep === "signin" && (
              <div>
                {brandingBlockSignUp}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await onEmailSignIn({ email: signinEmail, password: signinPassword });
                  }}
                  className="space-y-3"
                >
                  <div className={inputWrapperClass}>
                    <Mail className="h-5 w-5 shrink-0 text-white/45" />
                    <input
                      type="email"
                      value={signinEmail}
                      onChange={(e) => setSigninEmail(e.target.value)}
                      placeholder="Enter your email"
                      className={inputFieldClass}
                    />
                  </div>

                  <div className={inputWrapperClass}>
                    <KeyRound className="h-5 w-5 shrink-0 text-white/45" />
                    <input
                      type={showSigninPassword ? "text" : "password"}
                      value={signinPassword}
                      onChange={(e) => setSigninPassword(e.target.value)}
                      placeholder="Enter your password"
                      className={inputFieldClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSigninPassword((v) => !v)}
                      className="text-white/45 hover:text-white/80 transition-colors shrink-0"
                      aria-label={showSigninPassword ? "Hide password" : "Show password"}
                    >
                      {showSigninPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  <div className="text-right">
                    <a href="#" className="text-xs sm:text-sm text-white/50 hover:text-white/80 underline underline-offset-4 transition-colors">
                      Forgot Password?
                    </a>
                  </div>

                  <button type="submit" className={primaryActionButtonClass}>
                    Login <ArrowRight className="h-4 w-4" />
                  </button>

                  <button type="button" onClick={() => setAuthStep("options")} className={goBackButtonClass}>
                    <ArrowLeft className="h-4 w-4" /> Go Back
                  </button>

                  <div className="pt-1 flex justify-center">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-xs sm:text-sm text-white/50 hover:text-white/80 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <rect width="20" height="16" x="2" y="4" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                      Use SSO login
                    </button>
                  </div>
                </form>

                {footerLinks}
              </div>
            )}

            {authStep === "phone" && (
              <div>
                {brandingBlock}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setSendingCode(true);
                    try {
                      const sent = await onPhoneContinue({
                        name,
                        dialCode: selectedCountry?.dialCode || "",
                        phone,
                      });
                      // Only move on once the code is actually on its way; a
                      // failed send leaves the number on screen to correct.
                      if (sent) {
                        setOtpCode("");
                        setAuthStep("otp");
                        setCountryDropdownOpen(false);
                      }
                    } finally {
                      setSendingCode(false);
                    }
                  }}
                  className="space-y-3"
                >
                  <div className={inputWrapperClass}>
                    <UserRound className="h-5 w-5 text-white/45" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your name"
                      className={inputFieldClass}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-neutral-900/60 px-3 transition focus-within:ring-2 focus-within:ring-emerald-500/20 sm:px-4">
                      <button
                        type="button"
                        onClick={() => setCountryDropdownOpen((value) => !value)}
                        className="flex items-center gap-2 pr-3 border-r border-white/15 text-sm"
                      >
                        <span className="text-lg">{selectedCountry?.flag}</span>
                        <span className="text-sm">{selectedCountry?.dialCode}</span>
                        <ChevronDown className="h-4 w-4 text-white/45" />
                      </button>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Enter mobile number"
                        className="min-w-0 flex-1 bg-transparent text-base placeholder:text-white/40 outline-none"
                      />
                    </div>

                    {countryDropdownOpen && (
                      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-2">
                        <div className="mb-2 h-10 rounded-2xl border border-white/10 px-3 flex items-center gap-2 focus-within:ring-2 focus-within:ring-emerald-500/20">
                          <Search className="h-4 w-4 text-white/45" />
                          <input
                            value={countryQuery}
                            onChange={(e) => setCountryQuery(e.target.value)}
                            placeholder="Search your country"
                            className="w-full bg-transparent text-base placeholder:text-white/40 outline-none"
                          />
                        </div>

                        <div className="max-h-52 overflow-y-auto pr-1">
                          {filteredCountries.map((country) => {
                            const isSelected = country.code === selectedCountry?.code;
                            return (
                              <button
                                key={country.code}
                                type="button"
                                onClick={() => {
                                  setSelectedCountryCode(country.code);
                                  setCountryDropdownOpen(false);
                                  setCountryQuery("");
                                }}
                                className={`w-full rounded-xl px-3 py-2 flex items-center justify-between text-left transition ${
                                  isSelected ? "bg-emerald-500/20 text-emerald-400" : "hover:bg-white/5"
                                }`}
                              >
                                <span className="flex items-center gap-2 text-sm">
                                  <span>{country.flag}</span>
                                  <span>{country.name} ({country.dialCode})</span>
                                </span>
                                {isSelected && <Check className="h-4 w-4" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 pt-1">
                    <button type="submit" disabled={sendingCode} className={primaryActionButtonClass}>
                      {sendingCode ? "Sending code..." : <>Get code <ArrowRight className="h-4 w-4" /></>}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthStep("options");
                        setCountryDropdownOpen(false);
                      }}
                      className={goBackButtonClass}
                    >
                      <ArrowLeft className="h-4 w-4" /> Go Back
                    </button>
                  </div>
                </form>

                {footerLinks}
              </div>
            )}

            {authStep === "otp" && (
              <div>
                {brandingBlock}

                <p className="mb-4 text-center text-sm text-white/60">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-semibold text-white">
                    {selectedCountry?.dialCode}
                    {phone}
                  </span>
                </p>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await onPhoneVerify({
                      dialCode: selectedCountry?.dialCode || "",
                      phone,
                      token: otpCode.replace(/\D/g, ""),
                    });
                  }}
                  className="space-y-3"
                >
                  <div className={inputWrapperClass}>
                    <KeyRound className="h-5 w-5 shrink-0 text-white/45" />
                    <input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="Enter the 6-digit code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      // The code is the only thing on this screen, so it takes focus.
                      autoFocus
                      className={`${inputFieldClass} tracking-[0.35em]`}
                    />
                  </div>

                  <div className="space-y-3 pt-1">
                    <button
                      type="submit"
                      disabled={otpCode.replace(/\D/g, "").length < 6}
                      className={primaryActionButtonClass}
                    >
                      Verify and continue <ArrowRight className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      disabled={sendingCode}
                      onClick={async () => {
                        setSendingCode(true);
                        try {
                          await onPhoneContinue({
                            name,
                            dialCode: selectedCountry?.dialCode || "",
                            phone,
                          });
                        } finally {
                          setSendingCode(false);
                        }
                      }}
                      className={goBackButtonClass}
                    >
                      {sendingCode ? "Sending..." : "Resend code"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setOtpCode("");
                        setAuthStep("phone");
                      }}
                      className={goBackButtonClass}
                    >
                      <ArrowLeft className="h-4 w-4" /> Use a different number
                    </button>
                  </div>
                </form>

                {footerLinks}
              </div>
            )}
      </main>
    </div>
  );
}
