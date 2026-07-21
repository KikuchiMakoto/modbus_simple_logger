interface AppHeaderProps {
	isConnected: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
	onToggleConfig: () => void;
}

export function AppHeader({
	isConnected,
	onConnect,
	onDisconnect,
	onToggleConfig,
}: AppHeaderProps) {
	return (
		<header className="flex items-center justify-between border-b border-slate-200 p-2 dark:border-slate-800">
			<div className="flex items-center gap-3">
				<a
					href="https://github.com/takker/modbus-strain-calibrator"
					target="_blank"
					rel="noopener noreferrer"
					className="text-lg font-bold tracking-tight text-slate-900 hover:text-emerald-600 dark:text-slate-100 dark:hover:text-emerald-400"
				>
					ModbusStrainCalibrator
				</a>
			</div>

			<div className="flex items-center gap-2">
				{isConnected && (
					<span className="flex items-center gap-1 text-sm text-emerald-500">
						<span className="inline-block size-2 rounded-full bg-emerald-500" />
						Connected
					</span>
				)}
				<button
					type="button"
					className="button-primary text-sm"
					onClick={isConnected ? onDisconnect : onConnect}
				>
					{isConnected ? "Disconnect" : "Connect"}
				</button>
				<button
					type="button"
					className="button-secondary text-sm"
					onClick={onToggleConfig}
				>
					Menu
				</button>
			</div>
		</header>
	);
}
