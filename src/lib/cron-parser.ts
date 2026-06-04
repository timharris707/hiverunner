/**
 * Cron Parser Utilities
 * Parses cron expressions and calculates next run times
 */

interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

function parseCron(expr: string): CronParts | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  return {
    minute: parts[0],
    hour: parts[1],
    dayOfMonth: parts[2],
    month: parts[3],
    dayOfWeek: parts[4],
  };
}

/**
 * Get field values for a cron part
 */
function getFieldValues(field: string, min: number, max: number): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  if (field.includes('/')) {
    const [range, step] = field.split('/');
    const stepNum = parseInt(step);
    const start = range === '*' ? min : parseInt(range);
    const values: number[] = [];
    for (let i = start; i <= max; i += stepNum) {
      values.push(i);
    }
    return values;
  }

  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  if (field.includes(',')) {
    return field.split(',').map(Number);
  }

  return [parseInt(field)];
}

/**
 * Check if a date matches the cron expression
 */
function matchesCron(date: Date, parts: CronParts): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  const minuteMatch = getFieldValues(parts.minute, 0, 59).includes(minute);
  const hourMatch = getFieldValues(parts.hour, 0, 23).includes(hour);
  const dayOfMonthMatch = getFieldValues(parts.dayOfMonth, 1, 31).includes(dayOfMonth);
  const monthMatch = getFieldValues(parts.month, 1, 12).includes(month);
  const dayOfWeekMatch = getFieldValues(parts.dayOfWeek, 0, 6).includes(dayOfWeek);

  // Day matching: if both day-of-month and day-of-week are specified (not *),
  // then either can match. Otherwise, both must match.
  const dayOfMonthSpecified = parts.dayOfMonth !== '*';
  const dayOfWeekSpecified = parts.dayOfWeek !== '*';

  let dayMatch: boolean;
  if (dayOfMonthSpecified && dayOfWeekSpecified) {
    dayMatch = dayOfMonthMatch || dayOfWeekMatch;
  } else {
    dayMatch = dayOfMonthMatch && dayOfWeekMatch;
  }

  return minuteMatch && hourMatch && dayMatch && monthMatch;
}

/**
 * Calculate the next N run times for a cron expression
 * @param expr - Cron expression (5 parts)
 * @param count - Number of next runs to calculate
 * @param fromDate - Starting date (defaults to now)
 * @param timezone - Timezone (defaults to UTC)
 * @returns Array of Date objects representing next run times
 */
export function getNextRuns(
  expr: string,
  count: number = 3,
  fromDate: Date = new Date(),
  timezone: string = 'UTC'
): Date[] {
  const parts = parseCron(expr);
  if (!parts) return [];

  const runs: Date[] = [];
  const maxIterations = 525600; // Max 1 year of minutes
  
  // Start from the next minute
  const current = new Date(fromDate);
  current.setSeconds(0);
  current.setMilliseconds(0);
  current.setMinutes(current.getMinutes() + 1);

  let iterations = 0;
  while (runs.length < count && iterations < maxIterations) {
    if (matchesCron(current, parts)) {
      runs.push(new Date(current));
    }
    current.setMinutes(current.getMinutes() + 1);
    iterations++;
  }

  return runs;
}

/**
 * Validate a cron expression
 */
export function isValidCron(expr: string): boolean {
  const parts = parseCron(expr);
  if (!parts) return false;

  const validateField = (field: string, min: number, max: number): boolean => {
    if (field === '*') return true;
    
    // Handle step values (*/n or n/m)
    if (field.includes('/')) {
      const [range, step] = field.split('/');
      if (range !== '*' && !validateField(range, min, max)) return false;
      const stepNum = parseInt(step);
      return !isNaN(stepNum) && stepNum > 0;
    }

    // Handle ranges (n-m)
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number);
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end;
    }

    // Handle lists (n,m,...)
    if (field.includes(',')) {
      return field.split(',').every(v => {
        const num = parseInt(v);
        return !isNaN(num) && num >= min && num <= max;
      });
    }

    // Single value
    const num = parseInt(field);
    return !isNaN(num) && num >= min && num <= max;
  };

  return (
    validateField(parts.minute, 0, 59) &&
    validateField(parts.hour, 0, 23) &&
    validateField(parts.dayOfMonth, 1, 31) &&
    validateField(parts.month, 1, 12) &&
    validateField(parts.dayOfWeek, 0, 6)
  );
}
