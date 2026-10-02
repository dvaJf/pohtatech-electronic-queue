"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-2.5 sm:p-3 relative", className)}
      classNames={{
        root: "relative w-full max-w-[280px]",
        months: "relative flex flex-col space-y-3",
        month: "space-y-3 relative",
        month_caption: "flex justify-center pt-0.5 items-center text-xs font-bold text-slate-800 capitalize h-7",
        caption_label: "text-xs font-bold text-slate-800 capitalize",
        nav: "flex items-center justify-between absolute top-0 inset-x-0 w-full z-10 pointer-events-none px-0.5",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-white rounded-xl p-0 hover:bg-slate-100 border-slate-200 pointer-events-auto transition-colors text-slate-700 flex items-center justify-center shadow-2xs"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-white rounded-xl p-0 hover:bg-slate-100 border-slate-200 pointer-events-auto transition-colors text-slate-700 flex items-center justify-center shadow-2xs"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex justify-between",
        weekday:
          "text-slate-600 rounded-lg w-9 font-bold text-[0.72rem] uppercase text-center",
        week: "flex w-full mt-1.5 justify-between",
        day: "h-9 w-9 text-center text-xs p-0 relative rounded-xl focus-within:relative focus-within:z-20",
        day_button:
          "h-9 w-9 p-0 font-medium text-xs rounded-xl transition-all border-0 bg-transparent text-slate-800 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003B73] shadow-none",
        range_end: "range_end",
        selected:
          "[&>button]:!bg-[#003B73] [&>button]:!text-white [&>button]:!font-bold [&>button]:hover:!bg-[#054FA6] [&>button]:!border-transparent rounded-xl shadow-xs",
        today:
          "[&:not(.selected)>button]:!bg-blue-50/90 [&:not(.selected)>button]:!text-[#003B73] [&:not(.selected)>button]:!font-bold [&:not(.selected)>button]:!border [&:not(.selected)>button]:!border-blue-200",
        outside:
          "outside [&>button]:!text-slate-300 [&>button]:!opacity-40 [&>button]:hover:!bg-transparent",
        disabled:
          "text-slate-300 [&>button]:!text-slate-300 [&>button]:!opacity-40 [&>button]:!cursor-not-allowed [&>button]:hover:!bg-transparent",
        range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", className)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", className)} {...chevronProps} />
          ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
