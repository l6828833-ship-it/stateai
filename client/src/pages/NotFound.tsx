import { Button } from "@/components/ui/button";
import { Clapperboard, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(24,24,27,.09),transparent_38%)]" />
      <section className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-zinc-200 bg-card p-8 text-center shadow-[0_35px_100px_-50px_rgba(24,24,27,.55)] sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
          <Clapperboard className="h-5 w-5" />
        </div>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">
          Error 404
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-6xl">
          This scene does not exist.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-zinc-500 sm:text-base">
          The page may have moved, or the link may be out of date. Return to the
          EstateTour AI homepage and keep creating.
        </p>
        <div className="mt-8 flex justify-center">
          <Button
            onClick={() => setLocation("/")}
            className="h-11 rounded-full bg-zinc-950 px-6 text-white hover:bg-zinc-800"
          >
            <Home className="mr-2 h-4 w-4" /> Go home
          </Button>
        </div>
      </section>
    </main>
  );
}
