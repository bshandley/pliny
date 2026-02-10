import { BoardMember } from '../types';

interface MentionTextProps {
  text: string;
  boardMembers: BoardMember[];
  assignees: { id: string; name: string }[];
}

export default function MentionText({ text, boardMembers, assignees }: MentionTextProps) {
  const parts = text.split(/(@\w+)/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          const name = part.substring(1);
          const isMember = boardMembers.some(
            m => m.username.toLowerCase() === name.toLowerCase()
          );
          const isAssignee = assignees.some(
            a => a.name.toLowerCase() === name.toLowerCase()
          );

          if (isMember) {
            return (
              <span key={i} className="mention-chip mention-member">
                {part}
              </span>
            );
          }
          if (isAssignee) {
            return (
              <span key={i} className="mention-chip mention-assignee">
                {part}
              </span>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
