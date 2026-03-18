/** Direction facing (8 compass points) */
export type Direction = 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'north-west' | 'west' | 'south-west';

/** Enemy type identifiers */
export type EnemyType = 'SHADOW_WISP' | 'SHADOW_STALKER' | 'SHADOW_BEAST' | 'SHADOW_LORD' | 'FOG_CRAWLER' | 'SHADOW_ARCHER' | 'VOID_MAGE';

/** Building type identifiers */
export type BuildingType = 'TURRET' | 'OUTPOST' | 'FORGE' | 'WEAPON_SHOP' | 'ARMOR_WORKSHOP' | 'FRIEND_HUT';

/** Resource types */
export type ResourceType = 'wood' | 'stone' | 'metal' | 'gold';

/** Attack type for weapons */
export type AttackType = 'swing' | 'thrust' | 'shoot';

/** Weapon definition */
export interface WeaponDef {
  name: string;
  damage: number;
  range: number;
  speed: number;      // cooldown ms
  tier: number;
  color: number;
  attackType: AttackType;
  arcDeg: number;
  spriteFrame: number;
  chopBonus?: number;
  shadowBonus?: number;
  hitRadius?: number;
  splashRadius?: number;
  projectileSpeed?: number;
  cost?: Partial<Record<ResourceType, number>>;
}

/** Enemy stat definition */
export interface EnemyDef {
  name: string;
  hp: number;
  damage: number;
  speed: number;
  xp: number;
  size: number;
  color: number;
  gold: number;
  targetsFire?: boolean;
  ranged?: boolean;
  projectileSpeed?: number;
  attackRange?: number;
  attackCooldown?: number;
  projectileType?: 'arrow' | 'magic';
}

/** Building definition */
export interface BuildingDef {
  name: string;
  cost: Partial<Record<ResourceType, number>>;
  hp: number;
  desc: string;
  attackRange?: number;
  attackDamage?: number;
  attackSpeed?: number;
  lightRadius?: number;
  unlocks?: string[];
  armorBonus?: number;
  spawnsAlly?: boolean;
}

/** Light source data for fog shader */
export interface LightData {
  sx: number;   // screen X
  sy: number;   // screen Y
  radius: number;
  intensity: number;
  softness: number;
  tintR: number;
  tintG: number;
  tintB: number;
  tintA: number;
}

/** Player resources */
export interface Resources {
  wood: number;
  stone: number;
  metal: number;
  gold: number;
}
