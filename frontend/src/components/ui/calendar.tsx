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
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-3",
        month_caption: "flex justify-center pt-1 relative items-center text-xs font-bold text-slate-800 capitalize",
        caption_label: "text-xs font-bold text-slate-800 capitalize",
        nav: "space-x-1 flex items-center",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-white rounded-xl p-0 hover:bg-slate-100 border-slate-200 absolute left-1 transition-colors"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-white rounded-xl p-0 hover:bg-slate-100 border-slate-200 absolute right-1 transition-colors"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex justify-between",
        weekday:
          "text-slate-400 rounded-lg w-9 font-bold text-[0.7rem] uppercase text-center",
        week: "flex w-full mt-1.5 justify-between",
        day: "h-9 w-9 text-center text-xs p-0 relative rounded-xl focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-medium text-xs rounded-xl aria-selected:opacity-100 transition-all hover:bg-slate-100 text-slate-700"
        ),
        range_end: "range_end",
        selected:
          "bg-[#003B73] text-white hover:bg-[#054FA6] hover:text-white focus:bg-[#003B73] focus:text-white font-bold rounded-xl shadow-xs",
        today: "bg-blue-50/80 text-[#003B73] font-bold rounded-xl border border-blue-200/80",
        outside:
          "outside text-slate-300 aria-selected:bg-blue-100/50 aria-selected:text-slate-400 opacity-40",
        disabled: "text-slate-300 opacity-40 cursor-not-allowed",
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
