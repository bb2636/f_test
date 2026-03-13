import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { User, Case } from "@shared/schema";
import { ChevronDown, Calendar, AlertCircle, Wallet, CheckCircle2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { GlobalHeader } from "@/components/global-header";
import { 
  startOfMonth, 
  endOfMonth, 
  subMonths, 
  addMonths,
  isWithinInterval, 
  parseISO, 
  format, 
  startOfDay, 
  endOfDay,
  isSameDay,
  isSameMonth,
  getDaysInMonth,
  getDay,
  addDays,
  isAfter,
  isBefore
} from "date-fns";
import { ko } from "date-fns/locale";

type TabType = '전체' | '미결' | '미정산' | '일부정산';
type DateFilterType = '전체' | '오늘' | '이번 달' | '지난 달' | 'custom';

interface DateRange {
  from: Date | null;
  to: Date | null;
}

export default function MobileHome() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<TabType>('미정산');
  const [dateFilter, setDateFilter] = useState<DateFilterType>('이번 달');
  const [customDateRange, setCustomDateRange] = useState<DateRange>({ from: null, to: null });
  const [tempDateRange, setTempDateRange] = useState<DateRange>({ from: null, to: null });
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVh();
    window.addEventListener('resize', setVh);
    return () => window.removeEventListener('resize', setVh);
  }, []);

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: allCases = [], isLoading: casesLoading } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
    enabled: !!user,
  });

  const { data: allUsers = [] } = useQuery<Omit<User, "password">[]>({
    queryKey: ["/api/users"],
    enabled: !!user,
  });

  const dateRange = useMemo(() => {
    const today = new Date();
    switch (dateFilter) {
      case '전체':
        return null;
      case '오늘':
        return { from: startOfDay(today), to: endOfDay(today) };
      case '이번 달':
        return { from: startOfMonth(today), to: endOfMonth(today) };
      case '지난 달':
        return { from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) };
      case 'custom':
        if (customDateRange.from && customDateRange.to) {
          return { from: startOfDay(customDateRange.from), to: endOfDay(customDateRange.to) };
        }
        return null;
      default:
        return { from: startOfMonth(today), to: endOfMonth(today) };
    }
  }, [dateFilter, customDateRange]);

  const lastMonthRange = useMemo(() => ({
    from: startOfMonth(subMonths(new Date(), 1)),
    to: endOfMonth(subMonths(new Date(), 1)),
  }), []);

  const filteredCases = useMemo(() => {
    return allCases.filter(c => {
      if (c.status === '작성중' || !c.accidentDate) return false;
      if (!dateRange) return true;
      try {
        const caseDate = parseISO(c.accidentDate);
        return isWithinInterval(caseDate, { start: dateRange.from!, end: dateRange.to! });
      } catch {
        return false;
      }
    });
  }, [allCases, dateRange]);

  const lastMonthCases = useMemo(() => {
    return allCases.filter(c => {
      if (c.status === '작성중' || !c.accidentDate) return false;
      try {
        const caseDate = parseISO(c.accidentDate);
        return isWithinInterval(caseDate, { start: lastMonthRange.from, end: lastMonthRange.to });
      } catch {
        return false;
      }
    });
  }, [allCases, lastMonthRange]);

  const thisMonthCases = useMemo(() => {
    const thisMonthRange = { from: startOfMonth(new Date()), to: endOfMonth(new Date()) };
    return allCases.filter(c => {
      if (c.status === '작성중' || !c.accidentDate) return false;
      try {
        const caseDate = parseISO(c.accidentDate);
        return isWithinInterval(caseDate, { start: thisMonthRange.from, end: thisMonthRange.to });
      } catch {
        return false;
      }
    });
  }, [allCases]);

  const stats = useMemo(() => {
    const receptionCount = filteredCases.length;
    const thisMonthReceptionCount = thisMonthCases.length;
    const lastMonthReceptionCount = lastMonthCases.length;
    const changePercent = lastMonthReceptionCount > 0 
      ? ((thisMonthReceptionCount - lastMonthReceptionCount) / lastMonthReceptionCount * 100).toFixed(1)
      : '0';
    
    const pendingCount = filteredCases.filter(c => 
      c.status === '제출' || c.status === '검토중' || c.status === '1차승인'
    ).length;

    const unsettledCount = filteredCases.filter(c => c.status === '완료').length;

    return {
      receptionCount,
      pendingCount,
      unsettledCount,
      changePercent,
      isIncrease: thisMonthReceptionCount >= lastMonthReceptionCount,
    };
  }, [filteredCases, thisMonthCases, lastMonthCases]);

  const filteredCasesByTab = useMemo(() => {
    switch (activeTab) {
      case '전체':
        return filteredCases;
      case '미결':
        return filteredCases.filter(c => 
          c.status === '제출' || c.status === '검토중' || c.status === '1차승인'
        );
      case '미정산':
        return filteredCases.filter(c => c.status === '완료');
      case '일부정산':
        return filteredCases.filter(c => c.status === '완료');
      default:
        return filteredCases;
    }
  }, [filteredCases, activeTab]);

  const staffSummary = useMemo(() => {
    const userCaseCounts = new Map<string, { name: string; count: number; amount: number }>();

    filteredCasesByTab.forEach(c => {
      const assignedToId = c.assignedTo || 'unassigned';
      const existing = userCaseCounts.get(assignedToId);
      const parseAmount = (val: string | null | undefined) => {
        if (!val) return 0;
        const cleaned = val.replace(/,/g, '');
        const num = Number(cleaned);
        return isNaN(num) ? 0 : num;
      };
      const caseAmount = parseAmount(c.approvedAmount) || parseAmount(c.estimateAmount);

      if (existing) {
        existing.count++;
        existing.amount += caseAmount;
      } else {
        const assignedUser = allUsers.find(u => u.id === assignedToId);
        userCaseCounts.set(assignedToId, {
          name: assignedUser ? assignedUser.name : '미배정',
          count: 1,
          amount: caseAmount,
        });
      }
    });

    return Array.from(userCaseCounts.values()).sort((a, b) => b.count - a.count);
  }, [filteredCasesByTab, allUsers]);

  const formatAmount = (amount: number) => {
    return amount.toLocaleString('ko-KR') + ' 원';
  };

  const getDateFilterLabel = () => {
    if (dateFilter === 'custom' && customDateRange.from && customDateRange.to) {
      return `${format(customDateRange.from, 'MM.dd')} - ${format(customDateRange.to, 'MM.dd')}`;
    }
    return dateFilter === 'custom' ? '날짜 선택' : dateFilter;
  };

  const handleDateFilterSelect = (filter: DateFilterType) => {
    if (filter === 'custom') {
      setTempDateRange({ from: null, to: null });
      setIsDateFilterOpen(false);
      setIsCalendarOpen(true);
    } else {
      setDateFilter(filter);
      setCustomDateRange({ from: null, to: null });
      setIsDateFilterOpen(false);
    }
  };

  const handleDateClick = (date: Date) => {
    if (!tempDateRange.from || (tempDateRange.from && tempDateRange.to)) {
      setTempDateRange({ from: date, to: null });
    } else {
      if (isBefore(date, tempDateRange.from)) {
        setTempDateRange({ from: date, to: tempDateRange.from });
      } else {
        setTempDateRange({ from: tempDateRange.from, to: date });
      }
    }
  };

  const handleResetDate = () => {
    setTempDateRange({ from: null, to: null });
  };

  const handleApplyDate = () => {
    if (tempDateRange.from && tempDateRange.to) {
      setCustomDateRange(tempDateRange);
      setDateFilter('custom');
      setIsCalendarOpen(false);
    }
  };

  const renderCalendarMonth = (monthDate: Date) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const daysInMonth = getDaysInMonth(monthDate);
    const firstDayOfMonth = getDay(new Date(year, month, 1));
    const prevMonthDays = getDaysInMonth(subMonths(monthDate, 1));

    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthDays - i),
        isCurrentMonth: false,
      });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });
    }

    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }

    const weeks: { date: Date; isCurrentMonth: boolean }[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    return weeks.slice(0, 6);
  };

  const isDateInRange = (date: Date) => {
    if (!tempDateRange.from || !tempDateRange.to) return false;
    return isWithinInterval(date, { start: tempDateRange.from, end: tempDateRange.to });
  };

  const isStartDate = (date: Date) => {
    return tempDateRange.from && isSameDay(date, tempDateRange.from);
  };

  const isEndDate = (date: Date) => {
    return tempDateRange.to && isSameDay(date, tempDateRange.to);
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch("/api/check-session");
        const data = await response.json();
        if (!data.authenticated) {
          setLocation("/mobile-login");
        }
      } catch (error) {
        console.error("Session check failed:", error);
        setLocation("/mobile-login");
      }
    };

    checkSession();
  }, [setLocation]);

  if (userLoading || casesLoading) {
    return (
      <div 
        className="relative w-full bg-white flex items-center justify-center"
        style={{ minHeight: 'calc(var(--vh, 1vh) * 100)' }}
      >
        <div className="animate-pulse text-gray-400">로딩 중...</div>
      </div>
    );
  }

  const tabs: TabType[] = ['전체', '미결', '미정산', '일부정산'];
  const filterOptions: DateFilterType[] = ['전체', '오늘', '이번 달', '지난 달', 'custom'];
  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div 
      className="relative w-full bg-white"
      style={{ minHeight: 'calc(var(--vh, 1vh) * 100)' }}
    >
      <GlobalHeader />

      <div className="flex flex-col">
        <div
          className="flex flex-col items-center px-5 pt-4"
          style={{ gap: '16px' }}
        >
          <div
            style={{
              width: '335px',
              height: '51px',
              background: '#FDFDFD',
              boxShadow: '12px 12px 24px rgba(0, 0, 0, 0.06)',
              backdropFilter: 'blur(7px)',
              borderRadius: '14px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
            data-testid="card-user-profile"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 600,
                  fontSize: '15px',
                  lineHeight: '128%',
                  letterSpacing: '-0.02em',
                  color: '#0C0C0C',
                }}
                data-testid="text-user-name"
              >
                {user?.name || '사용자'}
              </span>
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 400,
                  fontSize: '13px',
                  lineHeight: '128%',
                  letterSpacing: '-0.01em',
                  color: '#008FED',
                }}
                data-testid="text-user-company"
              >
                {user?.company || '플록슨'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col mt-4">
          <div
            className="flex items-center px-5"
            style={{
              height: '55px',
            }}
          >
            <span
              style={{
                fontFamily: 'Pretendard',
                fontWeight: 600,
                fontSize: '18px',
                lineHeight: '128%',
                letterSpacing: '-0.02em',
                color: '#0C0C0C',
              }}
              data-testid="text-reception-title"
            >
              접수 현황
            </span>
          </div>

          <button
            onClick={() => setIsDateFilterOpen(true)}
            className="flex items-center px-5"
            style={{
              height: '39px',
              gap: '8px',
            }}
            data-testid="button-date-filter-reception"
          >
            <span
              style={{
                fontFamily: 'Pretendard',
                fontWeight: 600,
                fontSize: '15px',
                lineHeight: '128%',
                letterSpacing: '-0.02em',
                color: 'rgba(12, 12, 12, 0.9)',
              }}
            >
              {getDateFilterLabel()}
            </span>
            <ChevronDown 
              style={{ width: '18px', height: '18px', color: 'rgba(12, 12, 12, 0.6)' }}
            />
          </button>

          <div className="flex flex-col px-4" style={{ gap: '12px' }}>
            <div
              className="flex justify-between items-center"
              style={{ padding: '12px 0', height: '46px' }}
            >
              <div className="flex items-center" style={{ gap: '8px' }}>
                <Calendar style={{ width: '22px', height: '22px', color: 'rgba(12, 12, 12, 0.3)' }} />
                <span
                  style={{
                    fontFamily: 'Pretendard',
                    fontWeight: 500,
                    fontSize: '16px',
                    lineHeight: '128%',
                    letterSpacing: '-0.02em',
                    color: 'rgba(12, 12, 12, 0.8)',
                  }}
                >
                  접수
                </span>
              </div>
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 600,
                  fontSize: '16px',
                  lineHeight: '128%',
                  letterSpacing: '-0.02em',
                  color: '#0C0C0C',
                }}
                data-testid="text-reception-count"
              >
                {stats.receptionCount.toString().padStart(3, '0')}
              </span>
            </div>

            <div
              className="flex justify-center items-center"
              style={{
                height: '42px',
                background: 'rgba(12, 12, 12, 0.05)',
                borderRadius: '8px',
                padding: '12px 10px',
              }}
            >
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 400,
                  fontSize: '14px',
                  lineHeight: '128%',
                  letterSpacing: '-0.01em',
                  color: 'rgba(12, 12, 12, 0.7)',
                }}
                data-testid="text-reception-change"
              >
                접수건이 지난 달보다 {stats.changePercent}% {stats.isIncrease ? '늘었어요' : '줄었어요'}
              </span>
            </div>

            <div
              className="flex justify-between items-center"
              style={{ padding: '12px 0', height: '46px' }}
            >
              <div className="flex items-center" style={{ gap: '8px' }}>
                <AlertCircle style={{ width: '22px', height: '22px', color: 'rgba(12, 12, 12, 0.3)' }} />
                <span
                  style={{
                    fontFamily: 'Pretendard',
                    fontWeight: 500,
                    fontSize: '16px',
                    lineHeight: '128%',
                    letterSpacing: '-0.02em',
                    color: 'rgba(12, 12, 12, 0.8)',
                  }}
                >
                  미결건
                </span>
              </div>
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 600,
                  fontSize: '16px',
                  lineHeight: '128%',
                  letterSpacing: '-0.02em',
                  color: '#0C0C0C',
                }}
                data-testid="text-pending-count"
              >
                {stats.pendingCount.toString().padStart(3, '0')}
              </span>
            </div>

            <div
              className="flex justify-between items-center"
              style={{ padding: '12px 0', height: '46px' }}
            >
              <div className="flex items-center" style={{ gap: '8px' }}>
                <Wallet style={{ width: '22px', height: '22px', color: 'rgba(12, 12, 12, 0.3)' }} />
                <span
                  style={{
                    fontFamily: 'Pretendard',
                    fontWeight: 500,
                    fontSize: '16px',
                    lineHeight: '128%',
                    letterSpacing: '-0.02em',
                    color: 'rgba(12, 12, 12, 0.8)',
                  }}
                >
                  미정산
                </span>
              </div>
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 600,
                  fontSize: '16px',
                  lineHeight: '128%',
                  letterSpacing: '-0.02em',
                  color: '#0C0C0C',
                }}
                data-testid="text-unsettled-count"
              >
                {stats.unsettledCount.toString().padStart(3, '0')}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            width: '100%',
            height: '8px',
            background: 'rgba(12, 12, 12, 0.06)',
            marginTop: '16px',
          }}
        />

        <div className="flex flex-col">
          <div
            className="flex items-center px-5"
            style={{
              height: '55px',
            }}
          >
            <span
              style={{
                fontFamily: 'Pretendard',
                fontWeight: 600,
                fontSize: '18px',
                lineHeight: '128%',
                letterSpacing: '-0.02em',
                color: 'rgba(12, 12, 12, 0.9)',
              }}
              data-testid="text-manager-summary-title"
            >
              담당자 요약
            </span>
          </div>

          <button
            onClick={() => setIsDateFilterOpen(true)}
            className="flex items-center px-5"
            style={{
              height: '39px',
              gap: '8px',
            }}
            data-testid="button-date-filter-summary"
          >
            <span
              style={{
                fontFamily: 'Pretendard',
                fontWeight: 600,
                fontSize: '15px',
                lineHeight: '128%',
                letterSpacing: '-0.02em',
                color: 'rgba(12, 12, 12, 0.8)',
              }}
            >
              {getDateFilterLabel()}
            </span>
            <ChevronDown 
              style={{ width: '18px', height: '18px', color: 'rgba(12, 12, 12, 0.6)' }}
            />
          </button>

          <div
            className="flex items-center"
            style={{
              height: '40px',
              filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.02))',
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 flex justify-center items-center"
                style={{
                  height: '40px',
                  borderBottom: activeTab === tab ? '2px solid #008FED' : 'none',
                  fontFamily: 'Pretendard',
                  fontWeight: activeTab === tab ? 600 : 400,
                  fontSize: '14px',
                  lineHeight: '128%',
                  letterSpacing: '-0.01em',
                  color: activeTab === tab ? '#0C0C0C' : 'rgba(12, 12, 12, 0.5)',
                }}
                data-testid={`tab-${tab}`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div
            className="flex items-center px-4"
            style={{
              height: '39px',
              background: 'rgba(12, 12, 12, 0.04)',
              borderRadius: '8px',
            }}
          >
            <div className="flex items-center" style={{ width: '126px' }}>
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 500,
                  fontSize: '15px',
                  lineHeight: '128%',
                  letterSpacing: '-0.01em',
                  color: 'rgba(12, 12, 12, 0.6)',
                }}
              >
                성함
              </span>
            </div>
            <div className="flex-1 flex items-center">
              <span
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 500,
                  fontSize: '15px',
                  lineHeight: '128%',
                  letterSpacing: '-0.01em',
                  color: 'rgba(12, 12, 12, 0.6)',
                }}
              >
                건 수
              </span>
            </div>
          </div>

          <div
            className="flex flex-col"
            style={{
              borderRadius: '12px',
              padding: '8px 0',
            }}
          >
            {staffSummary.length === 0 ? (
              <div
                className="flex items-center justify-center px-4"
                style={{ height: '52px' }}
              >
                <span
                  style={{
                    fontFamily: 'Pretendard',
                    fontWeight: 400,
                    fontSize: '14px',
                    color: 'rgba(12, 12, 12, 0.5)',
                  }}
                >
                  데이터가 없습니다
                </span>
              </div>
            ) : (
              staffSummary.map((staff, index) => (
                <div
                  key={index}
                  className="flex items-center px-4"
                  style={{ height: '52px' }}
                  data-testid={`staff-row-${index}`}
                >
                  <div className="flex items-center" style={{ width: '126px' }}>
                    <span
                      style={{
                        fontFamily: 'Pretendard',
                        fontWeight: 500,
                        fontSize: '14px',
                        lineHeight: '128%',
                        letterSpacing: '-0.01em',
                        color: '#0C0C0C',
                      }}
                    >
                      {staff.name}
                    </span>
                  </div>
                  <div className="flex-1 flex items-center" style={{ gap: '6px' }}>
                    <span
                      style={{
                        fontFamily: 'Pretendard',
                        fontWeight: 500,
                        fontSize: '14px',
                        lineHeight: '128%',
                        letterSpacing: '-0.01em',
                        color: '#0C0C0C',
                      }}
                    >
                      {staff.count}건
                    </span>
                    <span
                      style={{
                        fontFamily: 'Pretendard',
                        fontWeight: 400,
                        fontSize: '13px',
                        lineHeight: '128%',
                        letterSpacing: '-0.01em',
                        color: 'rgba(12, 12, 12, 0.5)',
                      }}
                    >
                      {formatAmount(staff.amount)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {isDateFilterOpen && (
        <div 
          className="fixed inset-0 z-50"
          onClick={() => setIsDateFilterOpen(false)}
        >
          <div 
            className="absolute inset-0 bg-black/30"
          />
          <div
            className="absolute bottom-0 left-0 right-0"
            style={{
              background: '#FDFDFD',
              border: '1px solid #FFFFFF',
              backdropFilter: 'blur(7px)',
              borderRadius: '14px 14px 0px 0px',
              paddingBottom: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="sheet-date-filter"
          >
            <div className="flex flex-col">
              {filterOptions.map((option) => (
                <button
                  key={option}
                  onClick={() => handleDateFilterSelect(option)}
                  className="flex justify-between items-center"
                  style={{
                    height: '44px',
                    padding: '12px 20px',
                  }}
                  data-testid={`option-${option === 'custom' ? '날짜 선택' : option}`}
                >
                  <span
                    style={{
                      fontFamily: 'Pretendard',
                      fontWeight: dateFilter === option ? 500 : 400,
                      fontSize: '16px',
                      lineHeight: '128%',
                      letterSpacing: '-0.02em',
                      color: dateFilter === option ? '#0C0C0C' : 'rgba(12, 12, 12, 0.7)',
                    }}
                  >
                    {option === 'custom' ? '날짜 선택' : option}
                  </span>
                  {dateFilter === option && (
                    <CheckCircle2 
                      style={{ width: '22px', height: '22px', color: '#008FED' }}
                      fill="#008FED"
                      stroke="white"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isCalendarOpen && (
        <div 
          className="fixed inset-0 z-50"
          onClick={() => setIsCalendarOpen(false)}
        >
          <div 
            className="absolute inset-0 bg-black/30"
          />
          <div
            className="absolute bottom-0 left-0 right-0"
            style={{
              background: '#FDFDFD',
              border: '2px solid #F1F1F3',
              borderRadius: '12px 12px 0px 0px',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="calendar-date-picker"
          >
            <div className="p-4">
              <div className="flex justify-between items-center mb-4">
                <button
                  onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}
                  className="p-2"
                >
                  <ChevronLeft style={{ width: '20px', height: '20px', color: '#0C0C0C' }} />
                </button>
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      fontFamily: 'Pretendard',
                      fontWeight: 600,
                      fontSize: '14px',
                      lineHeight: '128%',
                      letterSpacing: '-0.01em',
                      color: '#0C0C0C',
                    }}
                  >
                    {format(calendarMonth, 'yyyy년', { locale: ko })}
                  </span>
                  <span
                    style={{
                      fontFamily: 'Pretendard',
                      fontWeight: 600,
                      fontSize: '14px',
                      lineHeight: '128%',
                      letterSpacing: '-0.01em',
                      color: '#0C0C0C',
                    }}
                  >
                    {format(calendarMonth, 'MM월', { locale: ko })}
                  </span>
                </div>
                <button
                  onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}
                  className="p-2"
                >
                  <ChevronRight style={{ width: '20px', height: '20px', color: '#0C0C0C' }} />
                </button>
              </div>

              <div className="flex mb-2">
                {weekDays.map((day, index) => (
                  <div
                    key={day}
                    className="flex-1 flex justify-center items-center"
                    style={{
                      height: '38px',
                      fontFamily: 'Pretendard',
                      fontWeight: 500,
                      fontSize: '13px',
                      lineHeight: '128%',
                      letterSpacing: '-0.01em',
                      color: 'rgba(12, 12, 12, 0.6)',
                    }}
                  >
                    {day}
                  </div>
                ))}
              </div>

              {renderCalendarMonth(calendarMonth).map((week, weekIndex) => (
                <div key={weekIndex} className="flex">
                  {week.map((day, dayIndex) => {
                    const isInRange = isDateInRange(day.date);
                    const isStart = isStartDate(day.date);
                    const isEnd = isEndDate(day.date);
                    const isSelected = isStart || isEnd;

                    return (
                      <div
                        key={dayIndex}
                        className="flex-1 flex justify-center items-center"
                        style={{
                          height: '38px',
                        }}
                      >
                        <button
                          onClick={() => day.isCurrentMonth && handleDateClick(day.date)}
                          disabled={!day.isCurrentMonth}
                          className="flex justify-center items-center"
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: isStart ? '4px 0 0 4px' : isEnd ? '0 4px 4px 0' : isInRange ? '0' : '4px',
                            background: isSelected ? '#008FED' : isInRange ? '#E8F4FD' : 'transparent',
                            fontFamily: 'Pretendard',
                            fontWeight: 400,
                            fontSize: '14px',
                            lineHeight: '128%',
                            letterSpacing: '-0.01em',
                            color: !day.isCurrentMonth 
                              ? 'rgba(12, 12, 12, 0.4)' 
                              : isSelected 
                                ? '#FFFFFF' 
                                : 'rgba(12, 12, 12, 0.9)',
                          }}
                        >
                          {day.date.getDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="mt-4 mb-4">
                <div
                  style={{
                    fontFamily: 'Pretendard',
                    fontWeight: 600,
                    fontSize: '14px',
                    lineHeight: '128%',
                    letterSpacing: '-0.01em',
                    color: '#0C0C0C',
                  }}
                >
                  {format(addMonths(calendarMonth, 1), 'yyyy년', { locale: ko })}{' '}
                  {format(addMonths(calendarMonth, 1), 'MM월', { locale: ko })}
                </div>
              </div>

              <div className="flex mb-2">
                {weekDays.map((day) => (
                  <div
                    key={day}
                    className="flex-1 flex justify-center items-center"
                    style={{
                      height: '38px',
                      fontFamily: 'Pretendard',
                      fontWeight: 500,
                      fontSize: '13px',
                      lineHeight: '128%',
                      letterSpacing: '-0.01em',
                      color: 'rgba(12, 12, 12, 0.6)',
                    }}
                  >
                    {day}
                  </div>
                ))}
              </div>

              {renderCalendarMonth(addMonths(calendarMonth, 1)).map((week, weekIndex) => (
                <div key={weekIndex} className="flex">
                  {week.map((day, dayIndex) => {
                    const isInRange = isDateInRange(day.date);
                    const isStart = isStartDate(day.date);
                    const isEnd = isEndDate(day.date);
                    const isSelected = isStart || isEnd;

                    return (
                      <div
                        key={dayIndex}
                        className="flex-1 flex justify-center items-center"
                        style={{
                          height: '38px',
                        }}
                      >
                        <button
                          onClick={() => day.isCurrentMonth && handleDateClick(day.date)}
                          disabled={!day.isCurrentMonth}
                          className="flex justify-center items-center"
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: isStart ? '4px 0 0 4px' : isEnd ? '0 4px 4px 0' : isInRange ? '0' : '4px',
                            background: isSelected ? '#008FED' : isInRange ? '#E8F4FD' : 'transparent',
                            fontFamily: 'Pretendard',
                            fontWeight: 400,
                            fontSize: '14px',
                            lineHeight: '128%',
                            letterSpacing: '-0.01em',
                            color: !day.isCurrentMonth 
                              ? 'rgba(12, 12, 12, 0.4)' 
                              : isSelected 
                                ? '#FFFFFF' 
                                : 'rgba(12, 12, 12, 0.9)',
                          }}
                        >
                          {day.date.getDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div
              className="sticky bottom-0 left-0 right-0 flex flex-col gap-3 p-4"
              style={{
                background: '#FDFDFD',
                borderTop: '1px solid #F1F1F3',
              }}
            >
              <div
                style={{
                  fontFamily: 'Pretendard',
                  fontWeight: 400,
                  fontSize: '14px',
                  lineHeight: '128%',
                  letterSpacing: '-0.01em',
                  color: 'rgba(12, 12, 12, 0.7)',
                  textAlign: 'center',
                }}
              >
                {tempDateRange.from && tempDateRange.to
                  ? `${format(tempDateRange.from, 'yyyy.MM.dd')} - ${format(tempDateRange.to, 'yyyy.MM.dd')}`
                  : tempDateRange.from
                    ? `${format(tempDateRange.from, 'yyyy.MM.dd')} - 종료일 선택`
                    : '시작일을 선택해주세요'}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleResetDate}
                  className="flex-1 flex justify-center items-center"
                  style={{
                    height: '48px',
                    background: 'rgba(12, 12, 12, 0.05)',
                    borderRadius: '8px',
                    fontFamily: 'Pretendard',
                    fontWeight: 500,
                    fontSize: '15px',
                    lineHeight: '128%',
                    letterSpacing: '-0.02em',
                    color: 'rgba(12, 12, 12, 0.7)',
                  }}
                  data-testid="button-reset-date"
                >
                  초기화
                </button>
                <button
                  onClick={handleApplyDate}
                  disabled={!tempDateRange.from || !tempDateRange.to}
                  className="flex-1 flex justify-center items-center"
                  style={{
                    height: '48px',
                    background: tempDateRange.from && tempDateRange.to ? '#008FED' : 'rgba(0, 143, 237, 0.5)',
                    borderRadius: '8px',
                    fontFamily: 'Pretendard',
                    fontWeight: 500,
                    fontSize: '15px',
                    lineHeight: '128%',
                    letterSpacing: '-0.02em',
                    color: '#FFFFFF',
                  }}
                  data-testid="button-apply-date"
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
