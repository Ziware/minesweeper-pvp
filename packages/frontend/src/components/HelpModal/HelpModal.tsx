import React from 'react';
import { BALANCE, formatTimeControlPresetsList } from '@minesweeper-pvp/shared';
import { Icon } from '../Icon/Icon';
import styles from './HelpModal.module.css';

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  const boardSize         = BALANCE.board.size;
  const initialMinesRed   = BALANCE.board.initialMinesRed;
  const initialMinesBlue  = BALANCE.board.initialMinesBlue;
  const maxLives          = BALANCE.player.maxLives;
  const minesPerTurn      = BALANCE.phase3.minesPerTurn;
  const hqBonusMines      = BALANCE.phase3.hqInActionZoneBonusMines;
  const minesWithBonus    = minesPerTurn + hqBonusMines;
  const initialDefuses    = BALANCE.defuse.initialPerTurn;
  const defuseGrantEvery  = BALANCE.defuse.grantInterval;
  const presetsList       = formatTimeControlPresetsList();

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <h2 className={styles.title}><Icon name="mine" size="1.1em" /> Правила игры</h2>

        <div className={styles.content}>
          <section>
            <h3>🎯 Цель</h3>
            <p>
              Главная цель — захватить штаб противника: зону 1×2 клетки по центру
              края доски. Захват любой клетки штаба сразу приносит победу.
              Если у одного из игроков закончится время на партию — он проигрывает.
            </p>
          </section>

          <section>
            <h3>🗺️ Поле</h3>
            <p>
              Поле {boardSize}×{boardSize}. Красный владеет верхней половиной,
              синий — нижней. Штаб красного находится по центру верхнего края,
              штаб синего — по центру нижнего края. Штаб нельзя заминировать.
              В начале красный расставляет <strong>{initialMinesRed} мин</strong>,
              синий — <strong>{initialMinesBlue} мин</strong> на своей половине.
              Мины противника скрыты. Ходить начинает
              красный. У каждого игрока <strong>{maxLives} жизни</strong>.
            </p>
          </section>

          <section>
            <h3>🔄 Ход игрока (3 фазы)</h3>

            <div className={styles.phase}>
              <div className={styles.phaseTitle}>Фаза 1 — Выбор зоны</div>
              <p>
                Кликните на любую клетку поля — вокруг неё появится зона
                <strong> 3×3</strong> (жёлтая рамка) и зона <strong>5×5</strong> (синяя рамка).
                В зоне 3×3 должна быть хотя бы одна <em>доступная</em> союзная клетка:
                такая клетка соединена с вашим штабом непрерывным путём по соседним
                союзным клеткам через общие стороны.
                На своих клетках в зоне 3×3 появятся цифры — сколько мин противника
                находится рядом с каждой клеткой.
              </p>
            </div>

            <div className={styles.phase}>
              <div className={styles.phaseTitle}>Фаза 2 — Захват клеток</div>
              <p>
                В пределах зоны <strong>5×5</strong> можно захватывать клетки противника
                кликом по ним. Захват возможен только если захватываемая клетка
                соседствует по общей стороне хотя бы с одной <em>доступной</em> клеткой
                вашей территории — диагонали не считаются.
              </p>
              <p>
                Если в клетке <strong>есть мина</strong> — вы теряете жизнь, мина исчезает,
                клетка остаётся за противником, ход переходит к фазе 3.
              </p>
              <p>
                Доступную для захвата клетку можно <strong>разминировать</strong>
                (<kbd>Ctrl+Click</kbd>) в пределах лимита разминирований на этот ход.
                В начале игры лимит — <strong>{initialDefuses} разминирование на ход</strong>
                {' '}для каждого игрока. После каждых <strong>{defuseGrantEvery} совместных
                ходов</strong> лимит увеличивается на <strong>+1 для обоих игроков</strong>.
                Неиспользованные разминирования сгорают в конце хода —
                накопить их нельзя.
              </p>
              <p>
                Если в разминируемой клетке есть мина — она убирается, клетка
                переходит к вам, ход продолжается. Если мины нет — клетка переходит
                к вам, фаза 2 завершается и начинается фаза 3.
              </p>
              <p>
                Можно добровольно завершить фазу кнопкой <em>«Завершить захват»</em>.
              </p>
            </div>

            <div className={styles.phase}>
              <div className={styles.phaseTitle}>Фаза 3 — Расстановка мин</div>
              <p>
                Можно поставить от <strong>0 до {minesPerTurn} мин</strong> на любые свободные
                доступные клетки своей территории. Если выбранная в фазе 1 зона
                <strong> 5×5</strong> содержала хотя бы одну клетку <em>вашего</em> штаба —
                лимит увеличивается до <strong>{minesWithBonus} мин</strong>
                {' '}(+{hqBonusMines} за защитную зону).
                Можно завершить фазу расстановки мин вручную и передать ход противнику в любой момент.
              </p>
            </div>
          </section>

          <section>
            <h3>🏁 Завершение игры</h3>
            <ul>
              <li>Мгновенная победа за захват любой клетки штаба противника.</li>
              <li>Победа противника, если потеряны все <strong>{maxLives} жизни</strong> из-за взрывов на минах.</li>
              <li>Поражение у того, чьё время на партию первым истечёт.</li>
            </ul>
          </section>

          <section>
            <h3>🔢 Цифры</h3>
            <p>
              Цифра на клетке показывает сколько мин противника находится
              в 8 соседних клетках. <strong>0</strong> — мин рядом нет. Цифры
              показываются <strong>только в зоне 3×3</strong> выбранной игроком.
              Мины на своих клетках в зоне 3×3 скрыты — видны только цифры.
              Захват при этом выполняется только через 4 клетки по общей стороне.
            </p>
            <p>
              <strong>Аккорд.</strong> Если вы кликнете по своей открытой
              клетке с цифрой <strong>N</strong> в зоне 3×3, и рядом с ней (по 8
              соседям) стоит ровно <strong>N флажков</strong>, то разом
              откроются все остальные соседние закрытые клетки — как если
              бы вы кликнули по каждой из них. Если среди этих клеток окажется 
              мина — вы потеряете жизнь. Если же рядом с цифрой <strong>N</strong>
              стоит ровно <strong>N клеток противника</strong>, то на всех поствятся флажки.
            </p>
          </section>

          <section>
            <h3>⏱️ Часы</h3>
            <p>
              Партия играется с шахматными часами: <strong>X минут на всю партию
              + Y секунд за каждый завершённый ход</strong>. Перед созданием комнаты
              можно выбрать одну из вариаций: <strong>{presetsList}</strong>.
              Часы запускаются после фазы расстановки мин и идут на протяжении
              всех трёх фаз хода вплоть до передачи хода противнику.
              Часы не идут на этапе расстановки первых мин. В режиме игры против компьютера
              часов нет.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
