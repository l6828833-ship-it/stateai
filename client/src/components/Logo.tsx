import { cn } from "@/lib/utils";

/** EstateTour AI brand mark. */
export const LOGO_URL =
  "https://pub-1271a678a52f4664aa377c2be4276e07.r2.dev/file_00000000f3d471f48cc62ce3b9fdb289.png";

interface LogoProps {
  /** Size / shape overrides (e.g. "h-9 w-9 rounded-2xl"). */
  className?: string;
  /** Optional alt text override. */
  alt?: string;
}

/**
 * The brand logo image rendered with a smooth rounded border. Size and corner
 * radius default to a compact square but can be overridden via `className`
 * (tailwind-merge lets later classes win).
 */
export default function Logo({
  className,
  alt = "EstateTour AI logo",
}: LogoProps) {
  return (
    <img
      src={LOGO_URL}
      alt={alt}
      loading="eager"
      decoding="async"
      draggable={false}
      className={cn(
        "h-8 w-8 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-black/5",
        className
      )}
    />
  );
}
