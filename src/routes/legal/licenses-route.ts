import ossLicenses from '../../generated/oss-licenses.json'

/**
 * OSS Licenses page. Public route (`data: { auth: false }`). The package list
 * is NOT hand-authored: it is read from `src/generated/oss-licenses.json`,
 * which `scripts/generate-licenses.ts` produces from the production dependency
 * tree at build time (wired into the `prebuild` npm hook). The page therefore
 * reflects exactly what is distributed in the bundle and regenerates whenever
 * the dependency set changes — no manual upkeep, and it doubles as a license
 * audit. The surrounding labels are localized via i18n; the package data is
 * locale-independent.
 */
export interface OssLicensePackage {
	readonly name: string
	readonly version: string
	readonly license: string
	readonly publisher: string | null
	readonly repository: string | null
	readonly licenseText: string | null
}

export class LicensesRoute {
	public readonly packages: readonly OssLicensePackage[] =
		ossLicenses.packages as readonly OssLicensePackage[]
}
