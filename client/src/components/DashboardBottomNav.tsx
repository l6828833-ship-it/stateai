import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Clapperboard,
  Home,
  Menu,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardBottomNavProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
}

export default function DashboardBottomNav({
  onMenuClick,
  onCreateClick,
}: DashboardBottomNavProps) {
  const [location] = useLocation();

  const navItems = [
    { icon: Home, label: "Home", href: "/dashboard", id: "home" },
    { icon: Plus, label: "Create", href: "#", id: "create", onClick: onCreateClick },
    { icon: BarChart3, label: "Analytics", href: "#", id: "analytics" },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border/50 bg-card/95 backdrop-blur-sm lg:hidden">
      <div className="flex items-center justify-between h-16 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-lg"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Menu</span>
        </Button>

        <div className="flex items-center gap-1 flex-1 justify-center">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                if (item.onClick) {
                  item.onClick();
                } else if (item.href.startsWith("#")) {
                  document.getElementById(item.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
                }
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                location === item.href || (item.id === "create" && location === "/dashboard")
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="w-10" />
      </div>
    </nav>
  );
}
