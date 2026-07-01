import React from 'react';
import { Link } from 'react-router-dom';
import { NavBar } from '../../components/NavBar/NavBar';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';
import styles from './RulesPage.module.css';

const TOC = [
  { id: 'goal',    label: '🎯 Цель игры' },
  { id: 'field',   label: '🗺️ Поле' },
  { id: 'turn',    label: '🔄 Ход игрока' },
  { id: 'defuse',  label: '🔧 Дефюзеры' },
  { id: 'time',    label: '⏱️ Время' },
  { id: 'win',     label: '🏁 Победа' },
];

export function RulesPage() {
  const auth = useAuth();
  const settings = useSettings();

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={styles.layout}>
      <NavBar auth={auth} settings={settings} />
      <div className={styles.body}>
        {/* Sidebar TOC */}
        <nav className={styles.toc}>
          <div className={styles.tocTitle}>Содержание</div>
          {TOC.map((item) => (
            <button
              key={item.id}
              className={styles.tocLink}
              onClick={() => scrollTo(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
          <Link to="/" className={styles.tocBack}>← На главную</Link>
        </nav>

        <article className={styles.article}>
          <Link to="/" className={styles.backLink}>← На главную</Link>

          <h1 className={styles.pageTitle}>Правила игры</h1>
          <p className={styles.pageSubtitle}>Minesweeper PvP — тактическая дуэль на минном поле</p>

          <section id="goal" className={styles.section}>
            <h2 className={styles.sectionTitle}>🎯 Цель игры</h2>
            <p>
              Захвати штаб противника или уничтожь все его жизни взрывами мин.
              Каждый игрок начинает с несколькими жизнями и скрытыми минами на своей половине поля.
            </p>
          </section>

          <section id="field" className={styles.section}>
            <h2 className={styles.sectionTitle}>🗺️ Поле</h2>
            <p>
              Поле делится на две половины — красную и синюю. В начале каждый расставляет свои мины
              вручную на своей половине (никакого случайного размещения — тактика с первой секунды).
            </p>
            <ul className={styles.list}>
              <li>Мины противника скрыты — вы видите только раскрытые числа в зоне захвата.</li>
              <li>Захваченные клетки переходят под ваш контроль.</li>
              <li>Штаб (Headquarters) — ключевые клетки в углах поля. Захвати их — победишь.</li>
            </ul>
          </section>

          <section id="turn" className={styles.section}>
            <h2 className={styles.sectionTitle}>🔄 Ход игрока</h2>

            <h3 className={styles.subTitle}>Фаза 1 — Выбор зоны</h3>
            <p>
              Кликни по клетке на стыке или внутри территории, чтобы выбрать зону захвата 3×3 или 5×5.
              Зона выделяется и переходит в фазу захвата.
            </p>

            <h3 className={styles.subTitle}>Фаза 2 — Захват клеток</h3>
            <p>
              Открывай клетки в выбранной зоне. Правила те же, что в классическом сапёре:
            </p>
            <ul className={styles.list}>
              <li>Открытая клетка без мины показывает цифру — число мин по соседству.</li>
              <li>Открытая мина — взрыв: −1 жизнь, ход переходит к сопернику.</li>
              <li>
                <strong>Chord (аккорд)</strong>: если вокруг числа уже расставлено правильное количество флажков,
                ЛКМ на цифру сразу открывает все соседние неоткрытые клетки.
              </li>
              <li>Нажми «Завершить захват», когда захочешь закончить фазу.</li>
            </ul>

            <h3 className={styles.subTitle}>Фаза 3 — Установка мин</h3>
            <p>
              После захвата у тебя есть шанс поставить несколько новых мин в зоне. Это позволяет
              переместить угрозу ближе к противнику. Нажми «Передать ход» когда закончишь.
            </p>
          </section>

          <section id="defuse" className={styles.section}>
            <h2 className={styles.sectionTitle}>🔧 Дефюзеры</h2>
            <p>
              Дефюзер позволяет безопасно обезвредить одну мину без потери жизни.
              Они начисляются за успешные захваты и за активную игру.
              Используется автоматически при угрозе взрыва, если ты его активировал.
            </p>
          </section>

          <section id="time" className={styles.section}>
            <h2 className={styles.sectionTitle}>⏱️ Контроль времени</h2>
            <p>
              Перед игрой выбирается пресет контроля времени (например, 3+2 или 5+0).
              Первое число — минуты на весь матч для каждого игрока, второе — секунды добавки за каждый ход.
              Истечение времени означает поражение.
            </p>
          </section>

          <section id="win" className={styles.section}>
            <h2 className={styles.sectionTitle}>🏁 Победа и поражение</h2>
            <ul className={styles.list}>
              <li><strong>Штаб</strong>: захвати штаб противника — мгновенная победа.</li>
              <li><strong>Жизни</strong>: уничтожь все жизни противника взрывами его же мин.</li>
              <li><strong>Время</strong>: твоё время истекло — поражение.</li>
            </ul>
          </section>

          <div className={styles.backRow}>
            <Link to="/" className={styles.backLink}>← На главную</Link>
          </div>
        </article>
      </div>
    </div>
  );
}
