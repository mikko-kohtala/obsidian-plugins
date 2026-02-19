export interface FormatCheckResult {
	success: boolean;
	output: string;
	error?: string;
	timedOut?: boolean;
	exitCode?: number;
}
