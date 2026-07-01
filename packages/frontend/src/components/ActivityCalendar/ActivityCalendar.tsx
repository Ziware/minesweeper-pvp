import React, { useRef, useState, useEffect } from 'react';
import styles from './ActivityCalendar.module.css';

export interface ActivityDay {
  date:  string; // 'YYYY-MM-DD'
  count: number;
}

interface Props {
  activity: ActivityDay[];
  /** Max weeks to show (default 26 = ~6 months). Actual count is adaptive. */
  maxWeeks?: number;
}

// Build a full grid of days: [week][day], week starts on Monday
function buildGrid(activity: ActivityDay[], weeks: number): (ActivityDay & { level: 0 | 1 | 2 | 3 | 4 })[][] {
  const map = new Map<string, number>();
  for (const d of activity) map.set(d.date, d.count);

  const today = new Date();
  // Find upcoming Sunday (or today if already Sunday)
  const daysUntilSunday = (7 - today.getDay()) % 7;
  const endDay = new Date(today);
  endDay.setDate(today.getDate() + daysUntilSunday);

  // startDay lands on Monday (weeks * 7 days before endDay + 1)
  const totalDays = weeks * 7;
  const startDay = new Date(endDay);
  startDay.setDate(endDay.getDate() - totalDays + 1);

  const grid: (ActivityDay & { level: 0 | 1 | 2 | 3 | 4 })[][] = [];
  let week: (ActivityDay & { level: 0 | 1 | 2 | 3 | 4 })[] = [];

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDay);
    d.setDate(startDay.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = map.get(dateStr) ?? 0;
    const level: 0 | 1 | 2 | 3 | 4 = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 3 ? 3 : 4;
    week.push({ date: dateStr, count, level });
    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
  }
  if (week.length) grid.push(week);

  return grid;
}

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTH_NAMES_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
// Mon=0 through Sun=6 (within each week column)
const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Cell size in px (includes gap)
const CELL_STEP = 14; // 12px cell + 2px gap
const DAY_LABELS_WIDTH = 22; // approx width of day-label column

function formatTooltip(date: string, count: number): string {
  const d = new Date(date + 'T12:00:00'); // noon to avoid TZ edge cases
  const dayName = WEEKDAY_NAMES[d.getDay()];
  const day = d.getDate();
  const month = MONTH_NAMES_FULL[d.getMonth()];
  const year = d.getFullYear();
  const dateStr = `${dayName}, ${day} ${month} ${year}`;
  if (count === 0) return dateStr;
  const word = count === 1 ? 'игра' : count < 5 ? 'игры' : 'игр';
  return `${dateStr}\n${count} ${word}`;
}

export function ActivityCalendar({ activity, maxWeeks = 26 }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(maxWeeks);

  // Measure container width and compute how many weeks fit
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const compute = (width: number) => {
      const availableForGrid = width - DAY_LABELS_WIDTH - 8; // 8 = gap between labels and grid
      const w = Math.max(4, Math.min(maxWeeks, Math.floor(availableForGrid / CELL_STEP)));
      setWeeks(w);
    };

    // Initial measurement
    compute(el.offsetWidth);

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) compute(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWeeks]);

  const grid = buildGrid(activity, weeks);
  const numWeeks = grid.length;

  // Month labels: scan first day (Monday) of each week
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  grid.forEach((week, col) => {
    const month = new Date(week[0].date).getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ col, label: MONTH_NAMES[month] });
      lastMonth = month;
    }
  });

  const totalGames = activity.reduce((s, d) => s + d.count, 0);

  const monthRowStyle = {
    gridTemplateColumns: `repeat(${numWeeks}, 12px)`,
    gap: '2px',
  };

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <div className={styles.header}>
        <span className={styles.title}>Активность</span>
        <span className={styles.total}>{totalGames} игр за период</span>
      </div>

      <div className={styles.calendarArea}>
        {/* Day-of-week labels — only Mon, Wed, Fri visible */}
        <div className={styles.dayLabels}>
          {DAY_LABELS.map((d, i) => (
            <span
              key={i}
              className={styles.dayLabel}
              style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}
            >
              {d}
            </span>
          ))}
        </div>

        <div className={styles.gridWrapper}>
          {/* Month labels above the grid */}
          <div className={styles.monthRow} style={monthRowStyle}>
            {monthLabels.map(({ col, label }) => (
              <span
                key={col}
                className={styles.monthLabel}
                style={{ gridColumnStart: col + 1 }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* The grid itself */}
          <div className={styles.grid}>
            {grid.map((week, wIdx) => (
              <div key={wIdx} className={styles.week}>
                {week.map((day, dIdx) => (
                  <div
                    key={dIdx}
                    className={`${styles.cell} ${styles[`level${day.level}`]}`}
                    title={formatTooltip(day.date, day.count)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
