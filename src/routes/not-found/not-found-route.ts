import { route } from '@aurelia/router'

// The fallback of the shell's route table: it takes its title from here, as
// the other screens do from their route, and shows no page header.
@route({ data: { titleKey: 'nav.notFound', header: false } })
export class NotFoundRoute {}
