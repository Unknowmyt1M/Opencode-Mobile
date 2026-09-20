import React from 'react';
import { Icon } from '@iconify/react';
import { File } from 'lucide-react';
import { resolveFileIcon } from '../utils/fileIconResolver';

interface FileTypeIconProps {
  path?: string;
  size?: number;
  className?: string;
}

export const FileTypeIcon: React.FC<FileTypeIconProps> = ({
  path = '',
  size = 15,
  className = '',
}) => {
  const iconName = resolveFileIcon(path);

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={path ? path.split(/[/\\]/).pop() : 'File'}
    >
      <Icon
        icon={iconName}
        width={size}
        height={size}
        fallback={<File size={size} className="text-zinc-400" />}
      />
    </span>
  );
};

export default FileTypeIcon;
