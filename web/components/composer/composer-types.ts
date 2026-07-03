export type ComposerCommand = {
  id: string;
  title: string;
  description: string;
  disabled?: boolean;
  loading?: boolean;
  onSelect: () => void;
};
