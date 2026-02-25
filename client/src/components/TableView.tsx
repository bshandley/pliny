import { useState, useMemo } from 'react';
import { Board, Card, Column, Label, BoardMember } from '../types';
import TableCell from './TableCell';

interface TableViewProps {
  board: Board;
  filterCard: (card: Card) => boolean;
  isAdmin: boolean;
  onCardUpdate: () => void;
  onCardClick: (cardId: string) => void;
  boardMembers: BoardMember[];
}

type SortDir = 'asc' | 'desc';
type GroupBy = 'column' | 'assignee' | 'label' | 'none';

interface ColumnDef {
  key: string;
  label: string;
  width: string;
  visible: boolean;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Title', width: 'flex', visible: true },
  { key: 'status', label: 'Status', width: '140px', visible: true },
  { key: 'assignees', label: 'Assignees', width: '160px', visible: true },
  { key: 'due_date', label: 'Due Date', width: '120px', visible: true },
  { key: 'labels', label: 'Labels', width: '160px', visible: true },
  { key: 'description', label: 'Description', width: '200px', visible: false },
];

interface GroupData {
  label: string;
  cards: { card: Card; column: Column }[];
}

export default function TableView({ board, filterCard, isAdmin, onCardUpdate, onCardClick, boardMembers }: TableViewProps) {
  const storageKey = `table-columns-${board.id}`;
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ColumnDef[];
        // Merge with defaults to pick up any new columns
        return DEFAULT_COLUMNS.map(def => {
          const found = parsed.find(p => p.key === def.key);
          return found ? { ...def, visible: found.visible } : def;
        });
      } catch {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('column');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const visibleColumns = columns.filter(c => c.visible);

  const boardLabels: Label[] = useMemo(() => {
    const labels: Label[] = [];
    const seen = new Set<string>();
    board.columns?.forEach(col => {
      col.cards?.forEach(card => {
        card.labels?.forEach(l => {
          if (!seen.has(l.id)) {
            seen.add(l.id);
            labels.push(l);
          }
        });
      });
    });
    return labels;
  }, [board]);

  const allCards = useMemo(() => {
    const result: { card: Card; column: Column }[] = [];
    board.columns?.forEach(col => {
      col.cards?.filter(c => filterCard(c)).forEach(card => {
        result.push({ card, column: col });
      });
    });
    return result;
  }, [board, filterCard]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortKey(null);
        setSortDir(null);
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedCards = useMemo(() => {
    if (!sortKey || !sortDir) return allCards;
    return [...allCards].sort((a, b) => {
      let aVal: string | number, bVal: string | number;
      switch (sortKey) {
        case 'title':
          aVal = a.card.title.toLowerCase();
          bVal = b.card.title.toLowerCase();
          break;
        case 'status':
          aVal = a.column.position;
          bVal = b.column.position;
          break;
        case 'assignees':
          aVal = (a.card.assignees || []).map(a => a.username || a.display_name || '').join(',').toLowerCase();
          bVal = (b.card.assignees || []).map(a => a.username || a.display_name || '').join(',').toLowerCase();
          break;
        case 'due_date':
          aVal = a.card.due_date || '';
          bVal = b.card.due_date || '';
          break;
        case 'labels':
          aVal = (a.card.labels || []).map(l => l.name).join(',').toLowerCase();
          bVal = (b.card.labels || []).map(l => l.name).join(',').toLowerCase();
          break;
        default:
          aVal = '';
          bVal = '';
      }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [allCards, sortKey, sortDir]);

  const groups: GroupData[] = useMemo(() => {
    if (groupBy === 'none') return [{ label: 'All cards', cards: sortedCards }];

    const map = new Map<string, { card: Card; column: Column }[]>();
    const orderKeys: string[] = [];

    if (groupBy === 'column') {
      // Pre-populate in column position order
      board.columns?.forEach(col => {
        map.set(col.name, []);
        orderKeys.push(col.name);
      });
    }

    sortedCards.forEach(item => {
      let keys: string[];
      switch (groupBy) {
        case 'column':
          keys = [item.column.name];
          break;
        case 'assignee':
          keys = item.card.assignees?.length
            ? item.card.assignees.map(a => a.username || a.display_name || 'Unassigned')
            : ['Unassigned'];
          break;
        case 'label':
          keys = item.card.labels?.length ? item.card.labels.map(l => l.name) : ['No label'];
          break;
        default:
          keys = ['Other'];
      }
      keys.forEach(k => {
        if (!map.has(k)) {
          map.set(k, []);
          orderKeys.push(k);
        }
        map.get(k)!.push(item);
      });
    });

    return (groupBy === 'column' ? orderKeys : Array.from(map.keys()))
      .filter(k => map.get(k)!.length > 0)
      .map(label => ({ label, cards: map.get(label)! }));
  }, [sortedCards, groupBy, board.columns]);

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const toggleColumn = (key: string) => {
    const updated = columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c);
    setColumns(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <div className="table-group-selector">
          <label>Group by:</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>
            <option value="column">Status</option>
            <option value="assignee">Assignee</option>
            <option value="label">Label</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="column-picker-wrapper">
          <button className="btn-secondary btn-sm" onClick={() => setShowColumnPicker(!showColumnPicker)}>
            Columns
          </button>
          {showColumnPicker && (
            <div className="column-picker-dropdown">
              {columns.map(col => (
                <label key={col.key} className="column-picker-item">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={() => toggleColumn(col.key)}
                    disabled={col.key === 'title'}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="table-scroll">
        <table className="board-table">
          <thead>
            <tr>
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  style={{ width: col.width === 'flex' ? undefined : col.width }}
                  className={`table-header${sortKey === col.key ? ` sorted-${sortDir}` : ''}`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && <span className="sort-arrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => (
              <GroupRows
                key={group.label}
                group={group}
                visibleColumns={visibleColumns}
                collapsed={collapsedGroups.has(group.label)}
                onToggle={() => toggleGroup(group.label)}
                isAdmin={isAdmin}
                boardColumns={board.columns || []}
                boardLabels={boardLabels}
                onCardUpdate={onCardUpdate}
                onCardClick={onCardClick}
                showGroupHeader={groupBy !== 'none'}
                boardMembers={boardMembers}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({
  group,
  visibleColumns,
  collapsed,
  onToggle,
  isAdmin,
  boardColumns,
  boardLabels,
  onCardUpdate,
  onCardClick,
  showGroupHeader,
  boardMembers,
}: {
  group: GroupData;
  visibleColumns: ColumnDef[];
  collapsed: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  boardColumns: Column[];
  boardLabels: Label[];
  onCardUpdate: () => void;
  onCardClick: (cardId: string) => void;
  showGroupHeader: boolean;
  boardMembers: BoardMember[];
}) {
  return (
    <>
      {showGroupHeader && (
        <tr className="table-group-header" onClick={onToggle}>
          <td colSpan={visibleColumns.length}>
            <span className="group-toggle">{collapsed ? '▸' : '▾'}</span>
            {group.label}
            <span className="table-group-count">{group.cards.length}</span>
          </td>
        </tr>
      )}
      {!collapsed && group.cards.map(({ card, column }) => (
        <tr key={card.id}>
          {visibleColumns.map(col => (
            <TableCell
              key={col.key}
              card={card}
              column={column}
              field={col.key}
              isAdmin={isAdmin}
              boardColumns={boardColumns}
              boardLabels={boardLabels}
              onUpdate={onCardUpdate}
              onCardClick={onCardClick}
              boardMembers={boardMembers}
            />
          ))}
        </tr>
      ))}
    </>
  );
}
