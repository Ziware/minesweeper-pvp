import React from 'react';
import styles from './ActivityCalendar.module.css';

export interface ActivityDay {
  date:  string; // 'YYYY-MM-DD'
  count: number;
}

interface Props {
  activity: ActivityDay[];
  /** Number of weeks to show (default 26 = ~6 months) */
  weeks?: number;
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

  // startDay is the Monday weeks*7 days before Sunday, so grid is weeks full Mon-Sun weeks
  const totalDays = weeks * 7;
  const startDay = new Date(endDay);
  startDay.setDate(endDay.getDate() - totalDays + 1); // should land on a Monday

  const grid: (ActivityDay & { level: 0 | 1 | 2 | 3 | 4 })[][] = [];
  let week: (ActivityDay & { level: 0 | 1 | 2 | 3 | 4 })[] = [];

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDay);
    d.setDate(startDay.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = map.get(dateStr) ?? 0;
    const level: 0 | 1 | 2 | 3 | 4 = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
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
// Mon=0 through Sun=6 (within each week column)
const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function ActivityCalendar({ activity, weeks = 26 }: Props) {
  const grid = buildGrid(activity, weeks);
  const numWeeks = grid.length;

  // Month labels: scan first day (Monday) of each week to detect month changes
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

  // Cell width (9px) + gap (2px) = 11px per column
  const cellStep = 11;
  const monthRowStyle = {
    gridTemplateColumns: `repeat(${numWeeks}, ${cellStep - 2}px)`,
    gap: '2px',
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Активность</span>
        <span className={styles.total}>{totalGames} игр за период</span>
      </div>

      <div className={styles.calendarArea}>
        {/* Day-of-week labels on the left — only show Mon, Wed, Fri */}
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
                    title={day.count > 0 ? `${day.date}: ${day.count} игр` : day.date}
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
