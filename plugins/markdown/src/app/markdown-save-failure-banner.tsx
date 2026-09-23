import { RefreshCw } from "lucide-react";

interface MarkdownSaveFailureBannerProps {
	failure: "backup-failed" | "save-failed";
	onRetry: () => void;
}

export function MarkdownSaveFailureBanner({
	failure,
	onRetry,
}: MarkdownSaveFailureBannerProps) {
	return (
		<section
			className="conflict-bar"
			data-testid="markdown-save-failure-banner"
			role="alert"
		>
			<span>
				{failure === "backup-failed"
					? "Couldn’t save or create a recovery copy. Keep this document open and retry."
					: "Couldn’t save to disk. A recovery copy is stored in Blabla."}
			</span>
			<button onClick={onRetry} type="button">
				<RefreshCw />
				Retry
			</button>
		</section>
	);
}
