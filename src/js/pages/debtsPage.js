export class DebtsPage {
    constructor(app) {
        this.app = app;
    }

    async render() {
        const debtEnabled = await this.app.dataService.getSetting('debtManagementEnabled');
        if (!debtEnabled?.value) {
            window.location.hash = '#settings';
            return;
        }
        await this.app.debtManager.renderDebtsPage(this.app.appContainer);
    }
}
