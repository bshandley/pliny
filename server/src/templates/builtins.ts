export interface TemplateData {
  columns: {
    name: string;
    position: number;
    cards: {
      title: string;
      description: string;
      position: number;
      checklist_items?: { text: string; position: number }[];
    }[];
  }[];
  labels: { name: string; color: string }[];
  custom_fields: {
    name: string;
    field_type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
    options?: string[];
    position: number;
    show_on_card: boolean;
  }[];
}

export interface BuiltinTemplate {
  name: string;
  description: string;
  data: TemplateData;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: 'Sprint Board',
    description: 'Agile sprint workflow with backlog, active work, review, and done columns.',
    data: {
      columns: [
        { name: 'Backlog', position: 0, cards: [
          { title: 'Define sprint goals', description: 'Outline what the team aims to accomplish this sprint.', position: 0, checklist_items: [
            { text: 'Review previous sprint outcomes', position: 0 },
            { text: 'Identify top priorities', position: 1 },
            { text: 'Set measurable goals', position: 2 },
          ]},
        ]},
        { name: 'In Progress', position: 1, cards: [] },
        { name: 'Review', position: 2, cards: [] },
        { name: 'Done', position: 3, cards: [] },
      ],
      labels: [
        { name: 'Feature', color: '#3b82f6' },
        { name: 'Bug', color: '#ef4444' },
        { name: 'Chore', color: '#8b5cf6' },
      ],
      custom_fields: [],
    },
  },
  {
    name: 'Bug Triage',
    description: 'Track bugs from report through resolution with severity labels.',
    data: {
      columns: [
        { name: 'Reported', position: 0, cards: [
          { title: 'Example bug report', description: 'Describe the issue, steps to reproduce, and expected behavior.', position: 0 },
        ]},
        { name: 'Confirmed', position: 1, cards: [] },
        { name: 'In Progress', position: 2, cards: [] },
        { name: 'Fixed', position: 3, cards: [] },
      ],
      labels: [
        { name: 'Critical', color: '#dc2626' },
        { name: 'Major', color: '#f97316' },
        { name: 'Minor', color: '#eab308' },
        { name: 'Cosmetic', color: '#6b7280' },
      ],
      custom_fields: [],
    },
  },
  {
    name: 'Project Tracker',
    description: 'Plan and track project phases from ideation to completion.',
    data: {
      columns: [
        { name: 'Ideas', position: 0, cards: [
          { title: 'Brainstorm features', description: 'Collect and evaluate potential features for the project.', position: 0 },
        ]},
        { name: 'Planning', position: 1, cards: [] },
        { name: 'Active', position: 2, cards: [] },
        { name: 'Complete', position: 3, cards: [] },
      ],
      labels: [
        { name: 'High Priority', color: '#ef4444' },
        { name: 'Medium Priority', color: '#f59e0b' },
        { name: 'Low Priority', color: '#22c55e' },
      ],
      custom_fields: [
        { name: 'Effort', field_type: 'dropdown', options: ['Small', 'Medium', 'Large'], position: 0, show_on_card: true },
      ],
    },
  },
];
