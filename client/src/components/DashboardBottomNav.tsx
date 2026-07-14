import { BarChart3, History, Home, Menu, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardBottomNavProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
  activeSection?: string;
  onNavigate?: (section: string) => void;
}

export default function DashboardBottomNav({
  onMenuClick,
  onCreateClick,
  activeSection = "create",
  onNavigate,
}: DashboardBottomNavProps) {
  const leftItems = [
    { icon: Home, label: "Home", section: "create" },
    { icon: History, label: "Videos", section: "videos" },
  ];
  const rightItems = [
    { icon: BarChart3, label: "Stats", section: "analytics" },
    { icon: Menu, label: "Menu", section: "menu" },
  ];

  const NavButton = ({
    icon: Icon,
    label,
    section,
  }: {
    icon: typeof Home;
    label: string;
    section: string;
  }) => {
    const active = activeSection === section;
    return (
      <button
        onClick={() => {
          if (section === "menu") onMenuClick?.();
          else onNavigate?.(section);
        }}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors",
          active ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className={cn("h-5 w-5 transition-transform", active && "scale-110")} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="glass-panel relative flex h-16 items-stretch rounded-t-3xl border-x-0 border-b-0 px-2 pb-[env(safe-area-inset-bottom)]">
        {leftItems.map((item) => (
          <NavButton key={item.section} {...item} />
        ))}

        {/* Elevated center Create button */}
        <div className="relative flex w-20 shrink-0 items-start justify-center">
          <button
            onClick={onCreateClick}
            className="btn-springy animate-glow-pulse absolute -top-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background"
            aria-label="Create tour"
          >
            <Plus className="h-6 w-6" />
          </button>
          <span className="mt-9 text-[10px] font-medium text-muted-foreground">Create</span>
        </div>

        {rightItems.map((item) => (
          <NavButton key={item.section} {...item} />
        ))}
      </div>
    </nav>
  );
}
