export type ModelCategory = 'recommended' | 'other' | 'expensive';
export type SelectableModel = {id:string;name?:string};
export function modelCategory(model:SelectableModel):ModelCategory;
export function groupModels(models?:SelectableModel[],selected?:string):{category:ModelCategory;models:SelectableModel[]}[];
