const __dum_scope = {};

function __dum_export(m, k, value) {
	if (!(m in __dum_scope)) __dum_scope[m] = {};
	if (k in __dum_scope[m]) throw `Exported item '${k}' in module '${m}' already exists`;
	__dum_scope[m][k] = value;
}

function __dum_import(m, k) {
	if (m in __dum_scope) {
		if (k) {
			if (k in __dum_scope[m]) return __dum_scope[m][k];
			throw `Cannot find item '${k}' in module '${m}'`;
		}
		return __dum_scope[m];
	}
	throw `Cannot find module '${m}'`;
}
