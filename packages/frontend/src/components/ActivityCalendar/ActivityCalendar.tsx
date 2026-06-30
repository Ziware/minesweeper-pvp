import React from 'react';
import styles from './ActivityCalendar.module.css';

export interface ActivityDay {
  date:  string; // 'YYYY-MM-DD'
  count: number;
}

interface Props {
  activity: ActivityDay[];
  /** Number of weeks to show (default 52) */
  weeks?: number;
}

// Build a full grid of days: [week][day]
function buildGrid(activity: ActivityDay[], weeks: number): (ActivityDay & { level: 0 | 1 | 2 | 3 | 4 })[][] {
  const map = new Map<string, number>();
  for (const d of activity) map.set(d.date, d.count);

  // Start from the most recent Sunday going back `weeks` weeks
  const today = new Date();
  // Advance to end of current week (Saturday)
  const endDay = new Date(today);
  endDay.setDate(today.getDate() + (6 - today.getDay())); // Saturday of this week

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
    const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
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
const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function ActivityCalendar({ activity, weeks = 52 }: Props) {
  const grid = buildGrid(activity, weeks);

  // Month labels: scan first day of each week to detect month changes
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

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Активность</span>
        <span className={styles.total}>{totalGames} игр за год</span>
      </div>

      <div className={styles.calendarArea}>
        {/* Day-of-week labels on the left */}
        <div className={styles.dayLabels}>
          {DAY_LABELS.map((d, i) => (
            <span key={i} className={styles.dayLabel} style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}>
              {d}
            </span>
          ))}
        </div>

        <div className={styles.gridWrapper}>
          {/* Month labels above the grid */}
          <div className={styles.monthRow}>
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
