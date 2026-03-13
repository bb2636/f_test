import { useState, useEffect } from "react";
import { X, RotateCcw, Calendar } from "lucide-react";
import { format, startOfMonth, endOfMonth, addMonths, subMonths, isSameDay, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { ko } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

interface DateRangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateRange: DateRange | undefined;
  onApply: (range: DateRange | undefined) => void;
}

export function DateRangeModal({ isOpen, onClose, dateRange, onApply }: DateRangeModalProps) {
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(dateRange);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    if (isOpen) {
      setSelectedRange(dateRange);
      if (dateRange?.from) {
        setCurrentMonth(startOfMonth(dateRange.from));
      } else {
        setCurrentMonth(startOfMonth(new Date()));
      }
    }
  }, [isOpen, dateRange]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const leftMonth = currentMonth;
  const rightMonth = addMonths(currentMonth, 1);

  const handlePrevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const handleDayClick = (day: Date) => {
    if (!selectedRange?.from || (selectedRange.from && selectedRange.to)) {
      setSelectedRange({ from: day, to: undefined });
    } else {
      if (day < selectedRange.from) {
        setSelectedRange({ from: day, to: selectedRange.from });
      } else {
        setSelectedRange({ from: selectedRange.from, to: day });
      }
    }
  };

  const handleReset = () => {
    setSelectedRange(undefined);
  };

  const handleApply = () => {
    onApply(selectedRange);
    onClose();
  };

  const isInRange = (day: Date) => {
    if (!selectedRange?.from || !selectedRange?.to) return false;
    return isWithinInterval(day, { start: startOfDay(selectedRange.from), end: endOfDay(selectedRange.to) });
  };

  const isStart = (day: Date) => {
    return selectedRange?.from && isSameDay(day, selectedRange.from);
  };

  const isEnd = (day: Date) => {
    return selectedRange?.to && isSameDay(day, selectedRange.to);
  };

  const renderMonth = (monthDate: Date) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: (Date | null)[] = [];
    
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    const remainingCells = 7 - (days.length % 7);
    if (remainingCells < 7) {
      for (let i = 0; i < remainingCells; i++) {
        days.push(null);
      }
    }

    return days;
  };

  const getDayClass = (day: Date | null) => {
    if (!day) return "h-9 rounded-lg";
    
    const baseClass = "grid h-9 place-items-center rounded-lg cursor-pointer hover:bg-slate-100 transition-colors";
    
    if (isStart(day) || isEnd(day)) {
      return `${baseClass} bg-[#0B6BFF] text-white font-semibold`;
    }
    
    if (isInRange(day)) {
      return `${baseClass} bg-[#EAF2FF] text-[#0B6BFF]`;
    }
    
    return baseClass;
  };

  const formatRangeText = () => {
    if (!selectedRange?.from) return "날짜를 선택하세요";
    if (!selectedRange.to) return format(selectedRange.from, "yyyy-MM-dd");
    return `${format(selectedRange.from, "yyyy-MM-dd")} ~ ${format(selectedRange.to, "yyyy-MM-dd")}`;
  };

  return (
    <div className="fixed inset-0 z-[999]">
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-[1px]" 
        onClick={onClose}
      />

      <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4">
        <div className="w-full max-w-[920px] rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF2FF] ring-1 ring-[#CFE0FF]">
                <Calendar className="h-4 w-4 text-[#0B6BFF]" />
              </span>
              <div className="font-bold text-slate-900">날짜 선택</div>
            </div>

            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100"
              aria-label="닫기"
              onClick={onClose}
            >
              <X className="h-5 w-5 text-slate-600" />
            </button>
          </div>

          <div className="px-6 py-5">
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 md:col-span-6">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-semibold text-slate-900">
                    {format(leftMonth, "yyyy년 MM월", { locale: ko })}
                  </div>
                  <button 
                    type="button" 
                    className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                    onClick={handlePrevMonth}
                  >
                    ‹
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-slate-500">
                  <div className="text-center">일</div>
                  <div className="text-center">월</div>
                  <div className="text-center">화</div>
                  <div className="text-center">수</div>
                  <div className="text-center">목</div>
                  <div className="text-center">금</div>
                  <div className="text-center">토</div>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-2 text-sm">
                  {renderMonth(leftMonth).map((day, idx) => (
                    <div
                      key={idx}
                      className={getDayClass(day)}
                      onClick={() => day && handleDayClick(day)}
                    >
                      {day?.getDate()}
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-12 md:col-span-6">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-semibold text-slate-900">
                    {format(rightMonth, "yyyy년 MM월", { locale: ko })}
                  </div>
                  <button 
                    type="button" 
                    className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                    onClick={handleNextMonth}
                  >
                    ›
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-slate-500">
                  <div className="text-center">일</div>
                  <div className="text-center">월</div>
                  <div className="text-center">화</div>
                  <div className="text-center">수</div>
                  <div className="text-center">목</div>
                  <div className="text-center">금</div>
                  <div className="text-center">토</div>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-2 text-sm">
                  {renderMonth(rightMonth).map((day, idx) => (
                    <div
                      key={idx}
                      className={getDayClass(day)}
                      onClick={() => day && handleDayClick(day)}
                    >
                      {day?.getDate()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
            <div className="text-sm font-semibold text-slate-900">
              {formatRangeText()}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                onClick={handleReset}
              >
                <RotateCcw className="h-4 w-4" />
                초기화
              </button>

              <button
                type="button"
                className="rounded-lg bg-[#0B6BFF] px-4 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90"
                onClick={handleApply}
              >
                적용
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
