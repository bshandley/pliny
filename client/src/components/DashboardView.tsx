import { useState, useEffect } from 'react';
import { api } from '../api';

interface DashboardFilter {
  assignee?: string;
  label?: string;
  due?: string;
  column?: string;
}

interface DashboardViewProps {
  boardId: string;
  refreshKey: number;
  onFilterNavigate?: (filters: DashboardFilter) => void;
}

interface Analytics {
  period: { days: number; start: string | null; end: string };
  summary: { total_cards: number; completed_cards: number; overdue_cards: number; avg_cycle_time_days: number };
  cards_by_column: { column_id: string; column_name: string; count: number }[];
  cards_by_assignee: { assignee: string; total: number; completed: number }[];
  cards_by_label: { label_id: string; label_name: string; label_color: string; count: number }[];
  cards_over_time: { date: string; created: number; completed: number }[];
  cycle_time_distribution: { range: string; count: number }[];
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function aggregateWeekly(data: { date: string; created: number; completed: number }[]): { date: string; created: number; completed: number }[] {
  const weeks: { date: string; created: number; completed: number }[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7);
    weeks.push({
      date: chunk[0].date,
      created: chunk.reduce((s, d) => s + d.created, 0),
      completed: chunk.reduce((s, d) => s + d.completed, 0),
    });
  }
  return weeks;
}

function BarChart({ title, data, onBarClick }: { title: string; data: { label: string; value: number; color?: string; key?: string }[]; onBarClick?: (key: string) => void }) {
  const max = Math.max(...data.map(d => d.value), 1);

  return (
    <div className="dashboard-chart">
      <h3 className="chart-title">{title}</h3>
      <div className="chart-bars">
        {data.map((item, i) => (
          <div
            key={i}
            className={`chart-bar-row${onBarClick ? ' chart-bar-clickable' : ''}`}
            onClick={() => onBarClick?.(item.key || item.label)}
          >
            <span className="chart-bar-label" title={item.label}>{item.label}</span>
            <div className="chart-bar-track">
              <div
                className="chart-bar-fill"
                style={{
                  width: `${(item.value / max) * 100}%`,
                  background: item.color || 'var(--primary)',
                }}
              />
            </div>
            <span className="chart-bar-value">{item.value}</span>
          </div>
        ))}
        {data.length === 0 && (
          <div className="chart-empty">No data</div>
        )}
      </div>
    </div>
  );
}

function OverTimeChart({ title, data }: { title: string; data: { date: string; created: number; completed: number }[] }) {
  const aggregated = data.length > 30 ? aggregateWeekly(data) : data;
  const max = Math.max(...aggregated.flatMap(d => [d.created, d.completed]), 1);

  return (
    <div className="dashboard-chart">
      <h3 className="chart-title">{title}</h3>
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--primary)' }} /> Created</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--success)' }} /> Completed</span>
      </div>
      <div className="overtime-chart">
        {aggregated.map((item, i) => (
          <div key={i} className="overtime-bar-group" title={`${formatShortDate(item.date)}: ${item.created} created, ${item.completed} completed`}>
            <div className="overtime-bars">
              <div className="overtime-bar created" style={{ height: `${(item.created / max) * 100}%` }} />
              <div className="overtime-bar completed" style={{ height: `${(item.completed / max) * 100}%` }} />
            </div>
            <span className="overtime-label">{formatShortDate(item.date)}</span>
          </div>
        ))}
        {aggregated.length === 0 && (
          <div className="chart-empty">No data</div>
        )}
      </div>
    </div>
  );
}

export default function DashboardView({ boardId, refreshKey, onFilterNavigate }: DashboardViewProps) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getBoardAnalytics(boardId, days)
      .then(setData)
      .catch(err => console.error('Failed to load analytics:', err))
      .finally(() => setLoading(false));
  }, [boardId, days, refreshKey]);

  return (
    <div className="dashboard-view">
      <div className="dashboard-header">
        <h2 className="dashboard-title">Dashboard</h2>
        <div className="dashboard-range-toggle">
          {[7, 30, 90, 0].map(d => (
            <button
              key={d}
              className={`btn-sm${days === d ? ' btn-primary' : ' btn-secondary'}`}
              onClick={() => setDays(d)}
            >
              {d === 0 ? 'All' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="dashboard-loading">Loading analytics...</div>
      ) : data ? (
        <>
          <div className="stat-cards">
            <div
              className={`stat-card${onFilterNavigate ? ' stat-card-clickable' : ''}`}
              onClick={() => onFilterNavigate?.({})}
            >
              <div className="stat-number">{data.summary.total_cards}</div>
              <div className="stat-label">Total Cards</div>
            </div>
            <div
              className={`stat-card stat-card-success${onFilterNavigate ? ' stat-card-clickable' : ''}`}
              onClick={() => onFilterNavigate?.({})}
            >
              <div className="stat-number">{data.summary.completed_cards}</div>
              <div className="stat-label">Completed</div>
            </div>
            <div
              className={`stat-card${data.summary.overdue_cards > 0 ? ' stat-card-danger' : ''}${onFilterNavigate ? ' stat-card-clickable' : ''}`}
              onClick={() => onFilterNavigate?.({ due: 'overdue' })}
            >
              <div className="stat-number">{data.summary.overdue_cards}</div>
              <div className="stat-label">Overdue</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{data.summary.avg_cycle_time_days}d</div>
              <div className="stat-label">Avg Cycle Time</div>
            </div>
          </div>

          <div className="chart-row">
            <BarChart
              title="Cards by Status"
              data={data.cards_by_column.map(c => ({ label: c.column_name, value: c.count, key: c.column_id }))}
              onBarClick={onFilterNavigate ? (key) => onFilterNavigate({ column: key }) : undefined}
            />
            <BarChart
              title="Cards by Assignee"
              data={data.cards_by_assignee.map(a => ({ label: a.assignee, value: a.total }))}
              onBarClick={onFilterNavigate ? (key) => onFilterNavigate({ assignee: key }) : undefined}
            />
          </div>

          <div className="chart-row">
            <OverTimeChart title="Created vs Completed" data={data.cards_over_time} />
            <div className="chart-stack">
              <BarChart
                title="Cards by Label"
                data={data.cards_by_label.map(l => ({ label: l.label_name, value: l.count, color: l.label_color, key: l.label_id }))}
                onBarClick={onFilterNavigate ? (key) => onFilterNavigate({ label: key }) : undefined}
              />
              <BarChart title="Cycle Time Distribution" data={data.cycle_time_distribution.map(c => ({ label: c.range, value: c.count }))} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
