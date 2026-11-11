export class CalendarWriteClosed extends Error {
  readonly code = 'CALENDAR_EXTERNAL_WRITE_NOT_AUTHORIZED' as const;

  constructor() {
    super('EXTERNAL CALENDAR WRITES ARE NOT AUTHORIZED');
    this.name = 'CalendarWriteClosed';
  }
}

export function createExternalEvent(): never {
  throw new CalendarWriteClosed();
}

export function updateExternalEvent(): never {
  throw new CalendarWriteClosed();
}

export function deleteExternalEvent(): never {
  throw new CalendarWriteClosed();
}

export function createConference(): never {
  throw new CalendarWriteClosed();
}

export function sendCalendarInvitation(): never {
  throw new CalendarWriteClosed();
}
