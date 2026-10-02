import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineIndicatorWrapper,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/ui/c-timeline-8-utils/timeline";

export interface TimelineStepItem {
  id: number;
  date?: string;
  title: string;
  description?: string;
}

export interface Timeline8Props {
  items?: TimelineStepItem[];
  currentStep?: number;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

const DEFAULT_RELEASE_CYCLE: TimelineStepItem[] = [
  {
    id: 1,
    date: "Этап 1",
    title: "Талон получен",
    description: "Регистрация в очереди",
  },
  {
    id: 2,
    date: "Этап 2",
    title: "В очереди",
    description: "Ожидание вызова",
  },
  {
    id: 3,
    date: "Этап 3",
    title: "Вызов к окну",
    description: "Приглашение к окну",
  },
  {
    id: 4,
    date: "Этап 4",
    title: "Обслуживание",
    description: "Работа с оператором",
  },
  {
    id: 5,
    date: "Этап 5",
    title: "Завершён",
    description: "Услуга оказана",
  },
];

export function Pattern({
  items = DEFAULT_RELEASE_CYCLE,
  currentStep = 2,
  className = "w-full max-w-xl",
  orientation = "horizontal",
}: Timeline8Props = {}) {
  return (
    <Timeline
      value={currentStep}
      orientation={orientation}
      className={className}
    >
      {items.map((item) => (
        <TimelineItem key={item.id} step={item.id}>
          <TimelineHeader>
            {item.date && <TimelineDate>{item.date}</TimelineDate>}
            <TimelineTitle>{item.title}</TimelineTitle>
            <TimelineIndicatorWrapper>
              <TimelineSeparator />
              <TimelineIndicator />
            </TimelineIndicatorWrapper>
          </TimelineHeader>
          {item.description && <TimelineContent>{item.description}</TimelineContent>}
        </TimelineItem>
      ))}
    </Timeline>
  );
}

export default Pattern;
