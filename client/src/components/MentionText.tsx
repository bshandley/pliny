import { BoardMember } from '../types';

interface MentionTextProps {
  text: string;
  boardMembers: BoardMember[];
}

export default function MentionText({ text, boardMembers }: MentionTextProps) {
  const parts = text.split(/(@\w+)/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          const name = part.substring(1);
          const isMember = boardMembers.some(
            m => m.username.toLowerCase() === name.toLowerCase()
          );

          if (isMember) {
            return (
              <span key={i} className="mention-chip mention-member">
                {name}
              </span>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
