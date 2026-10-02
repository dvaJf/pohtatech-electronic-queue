"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/c-calendar-14-utils/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface TimeSlotItem {
  time: string;
  available: boolean;
}

export interface Calendar14Props {
  selectedDate?: Date;
  onSelectDate?: (date: Date) => void;
  selectedTime?: string | null;
  onSelectTime?: (time: string) => void;
  timeSlots?: TimeSlotItem[];
  minDate?: Date;
  className?: string;
}

const DEFAULT_TIME_SLOTS: TimeSlotItem[] = [
  { available: false, time: "09:00" },
  { available: false, time: "09:30" },
  { available: true, time: "10:00" },
  { available: true, time: "10:30" },
  { available: true, time: "11:00" },
  { available: true, time: "11:30" },
  { available: false, time: "12:00" },
  { available: true, time: "12:30" },
  { available: true, time: "13:00" },
  { available: true, time: "13:30" },
  { available: true, time: "14:00" },
  { available: false, time: "14:30" },
  { available: false, time: "15:00" },
  { available: true, time: "15:30" },
  { available: true, time: "16:00" },
  { available: true, time: "16:30" },
  { available: true, time: "17:00" },
  { available: true, time: "17:30" },
];

export function Pattern({
  selectedDate: controlledDate,
  onSelectDate: controlledOnSelectDate,
  selectedTime: controlledTime,
  onSelectTime: controlledOnSelectTime,
  timeSlots: controlledSlots,
  minDate,
  className = "",
}: Calendar14Props = {}) {
  const today = new Date();
  const [internalDate, setInternalDate] = useState<Date>(today);
  const [internalTime, setInternalTime] = useState<string | null>(null);

  const date = controlledDate !== undefined ? controlledDate : internalDate;
  const time = controlledTime !== undefined ? controlledTime : internalTime;
  const timeSlots = controlledSlots || DEFAULT_TIME_SLOTS;

  const handleDateChange = (newDate: Date | undefined) => {
    if (newDate) {
      if (controlledOnSelectDate) {
        controlledOnSelectDate(newDate);
      } else {
        setInternalDate(newDate);
        setInternalTime(null);
      }
    }
  };

  const handleTimeChange = (slotTime: string) => {
    if (controlledOnSelectTime) {
      controlledOnSelectTime(slotTime);
    } else {
      setInternalTime(slotTime);
    }
  };

  const effectiveMinDate = minDate || today;

  return (
    <Card className={`p-0 overflow-hidden border border-slate-200/80 shadow-sm ${className}`}>
      <CardContent className="p-0">
        <div className="flex max-sm:flex-col">
          <Calendar
            locale={ru}
            disabled={[{ before: effectiveMinDate }]}
            mode="single"
            onSelect={handleDateChange}
            selected={date}
          />
          <div className="relative w-full max-sm:h-48 sm:w-44">
            <div className="absolute inset-0 py-4 max-sm:border-t">
              <ScrollArea className="h-full sm:border-s">
                <div className="space-y-3">
                  <div className="flex h-5 shrink-0 items-center px-4">
                    <p className="text-xs font-semibold text-slate-800 capitalize">
                      {format(date, "EEEE, d MMM", { locale: ru })}
                    </p>
                  </div>
                  <div className="grid gap-1.5 px-3 max-sm:grid-cols-2">
                    {timeSlots.map(({ time: timeSlot, available }) => (
                      <Button
                        className="w-full font-mono text-xs font-bold"
                        disabled={!available}
                        key={timeSlot}
                        onClick={() => handleTimeChange(timeSlot)}
                        size="sm"
                        variant={time === timeSlot ? "default" : "outline"}
                      >
                        {timeSlot}
                      </Button>
                    ))}
                  </div>
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default Pattern;
