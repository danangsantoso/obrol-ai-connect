import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  className?: string;
  /** 1-6: data-viz palette slot for the icon tile */
  accent?: number;
}

export function StatsCard({ 
  title, 
  value, 
  change, 
  changeType = "neutral", 
  icon: Icon,
  className,
  accent,
}: StatsCardProps) {
  return (
    <div className={cn(
      "bg-card rounded-xl p-6 border border-border shadow-card hover:shadow-lg transition-all duration-300 animate-slide-up",
      className
    )}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {title}
          </p>
          <p className="text-3xl font-bold text-foreground">
            {value}
          </p>
          {change && (
            <p className={cn(
              "text-sm mt-1 flex items-center",
              changeType === "positive" && "text-success",
              changeType === "negative" && "text-danger",
              changeType === "neutral" && "text-muted-foreground"
            )}>
              {change}
            </p>
          )}
        </div>
        <div
          className={cn(
            "w-12 h-12 rounded-lg flex items-center justify-center",
            !accent && "bg-primary/10 text-primary"
          )}
          style={accent ? { color: `var(--viz-${accent})`, background: `color-mix(in srgb, var(--viz-${accent}) 14%, transparent)` } : undefined}
        >
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}