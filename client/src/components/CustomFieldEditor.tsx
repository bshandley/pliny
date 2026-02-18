import { useState } from 'react';
import { CustomField } from '../types';

interface CustomFieldEditorProps {
  field: CustomField;
  value: string | null;
  onChange: (value: string | null) => void;
  readOnly: boolean;
}

export default function CustomFieldEditor({ field, value, onChange, readOnly }: CustomFieldEditorProps) {
  const [localValue, setLocalValue] = useState(value || '');

  const handleBlur = () => {
    const trimmed = localValue.trim();
    if (trimmed !== (value || '')) {
      onChange(trimmed || null);
    }
  };

  if (readOnly) {
    if (!value) return <span className="custom-field-value custom-field-empty">—</span>;
    switch (field.field_type) {
      case 'checkbox':
        return <span className="custom-field-value">{value === 'true' ? 'Yes' : 'No'}</span>;
      case 'date': {
        const d = new Date(value + 'T12:00:00');
        return <span className="custom-field-value">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>;
      }
      default:
        return <span className="custom-field-value">{value}</span>;
    }
  }

  switch (field.field_type) {
    case 'text':
      return (
        <input
          type="text"
          className="custom-field-input"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="Set value..."
          maxLength={500}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className="custom-field-input"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="0"
          step="any"
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className="custom-field-input"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'dropdown': {
      const options = field.options || [];
      return (
        <select
          className="custom-field-input"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Select...</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="custom-field-checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
      );
    default:
      return null;
  }
}
