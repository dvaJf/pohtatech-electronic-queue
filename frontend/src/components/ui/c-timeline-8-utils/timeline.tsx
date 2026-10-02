import * as React from "react";
import { cn } from "@/lib/utils";

interface TimelineContextValue {
  activeStep?: number;
  orientation?: "horizontal" | "vertical";
}

const TimelineContext = React.createContext<TimelineContextValue>({});

export interface TimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: number;
  value?: number;
  orientation?: "horizontal" | "vertical";
}

export function Timeline({
  defaultValue = 1,
  value,
  orientation = "horizontal",
  className,
  children,
  ...props
}: TimelineProps) {
  const activeStep = value !== undefined ? value : defaultValue;

  return (
    <TimelineContext.Provider value={{ activeStep, orientation }}>
      <div
        className={cn(
          "relative flex font-['Manrope']",
          orientation === "horizontal"
            ? "flex-row items-start justify-between w-full min-w-0"
            : "flex-col items-start space-y-4",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </TimelineContext.Provider>
  );
}

export interface TimelineItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number;
}

export function TimelineItem({
  step,
  className,
  children,
  ...props
}: TimelineItemProps) {
  const { activeStep, orientation } = React.useContext(TimelineContext);
  const isCompleted = activeStep !== undefined && step < activeStep;
  const isCurrent = activeStep !== undefined && step === activeStep;

  return (
    <div
      data-step={step}
      data-state={isCurrent ? "current" : isCompleted ? "completed" : "pending"}
      className={cn(
        "relative flex flex-col group flex-1 items-center text-center min-w-0 px-1",
        orientation === "horizontal" ? "min-w-0" : "w-full text-left",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TimelineHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center w-full min-w-0 mb-1",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TimelineIndicatorWrapper({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative w-full flex items-center justify-center my-1.5",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TimelineSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[2px] bg-slate-200 -z-0 group-first:left-1/2 group-last:right-1/2",
        "group-data-[state=completed]:bg-[#003B73] transition-colors duration-300",
        className
      )}
      {...props}
    />
  );
}

export function TimelineDate({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[10px] sm:text-[11px] font-medium text-slate-500 mb-0.5 tracking-tight truncate max-w-full",
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
}

export function TimelineTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h4
      className={cn(
        "text-[11px] sm:text-xs font-bold text-slate-700 transition-colors duration-200 truncate max-w-full leading-tight",
        "group-data-[state=current]:text-[#003B73] group-data-[state=current]:font-extrabold",
        "group-data-[state=completed]:text-slate-800",
        className
      )}
      {...props}
    >
      {children}
    </h4>
  );
}

export function TimelineIndicator({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative z-10 flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full border-2 transition-all duration-300",
        "group-data-[state=completed]:bg-[#003B73] group-data-[state=completed]:border-[#003B73] group-data-[state=completed]:text-white shadow-xs",
        "group-data-[state=current]:bg-blue-50 group-data-[state=current]:border-[#003B73] group-data-[state=current]:text-[#003B73] group-data-[state=current]:scale-110 shadow-md ring-4 ring-blue-100/70",
        "group-data-[state=pending]:bg-white group-data-[state=pending]:border-slate-300 group-data-[state=pending]:text-slate-400",
        className
      )}
      {...props}
    >
      {children || (
        <span className="h-2 w-2 rounded-full group-data-[state=current]:bg-[#003B73] group-data-[state=completed]:bg-white group-data-[state=pending]:bg-slate-300 transition-colors" />
      )}
    </div>
  );
}

export function TimelineContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[10px] sm:text-[11px] text-slate-500 mt-0.5 max-w-[120px] transition-colors leading-tight truncate sm:whitespace-normal",
        "group-data-[state=current]:text-[#003B73] group-data-[state=current]:font-semibold",
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
}
