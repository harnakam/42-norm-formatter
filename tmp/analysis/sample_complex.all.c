/* ************************************************************************** */
/*                                                                            */
/*                                                       :::      ::::::::    */
/*   sample_complex.c                                  :+:      :+:    :+:    */
/*                                                   +:+ +:+         +:+      */
/*   By: username <username@student.42tokyo.jp>    #+#  +:+       +#+         */
/*                                               +#+#+#+#+#+   +#+            */
/*   Created: 2026/03/13 07:51:33 by username         #+#    #+#              */
/*   Updated: 2026/03/13 07:51:33 by username        ###   ########.fr        */
/*                                                                            */
/* ************************************************************************** */

#include "sample_complex.h"

void	init_database(t_database *db)
{
	db->count = 0;
}

int	add_user(t_database *db, const char *name, int age, double score)
{
	t_user	*u;

	if (!db || db->count >= MAX_USERS)
	{
		return (-1);
	}
	u = &db->users[db->count];
	u->id = db->count + 1;
	strncpy(u->name, name, MAX_NAME_LEN - 1);
	u->name[MAX_NAME_LEN - 1] = '\0';
	u->age = age;
	u->score = score;
	db->count++;
	return (u->id);
}

void	print_user(const t_user *user)
{
	if (!user)
	{
		return ;
	}
	printf("ID:%d Name:%s Age:%d Score:%f\n", user->id, user->name, user->age, user->score);
}

void	print_database(const t_database *db)
{
	int	i;

	if (!db)
	{
		return ;
	}
	{
		i = 0;
		while (i < db->count)
		{
			print_user(&db->users[i]);
			i++;
		}
	}
}

t_user	*find_user_by_id(t_database *db, int id)
{
	int	i;

	if (!db)
	{
		return (NULL);
	}
	{
		i = 0;
		while (i < db->count)
		{
			if (db->users[i].id == id)
			{
				return (&db->users[i]);
			}
			i++;
		}
	}
	return (NULL);
}

void	remove_user_by_id(t_database *db, int id)
{
	int	i;
	int	j;

	if (!db)
	{
		return ;
	}
	{
		i = 0;
		while (i < db->count)
		{
			if (db->users[i].id == id)
			{
				{
					j = i;
					while (j < db->count - 1)
					{
						db->users[j] = db->users[j + 1];
						j++;
					}
				}
				db->count--;
				return ;
			}
			i++;
		}
	}
}

void	update_score(t_database *db, int id, double score)
{
	t_user	*u;

	u = find_user_by_id(db, id);
	if (u)
	{
		u->score = score;
	}
}

int	load_users_from_file(t_database *db, const char *filename)
{
	FILE	*f;
	char	name[MAX_NAME_LEN];
	int		age;
	double	score;

	f = fopen(filename, "r");
	if (!f)
	{
		return (-1);
	}
	while (fscanf(f, "%63s %d %lf", name, &age, &score) == 3)
	{
		add_user(db, name, age, score);
	}
	fclose(f);
	return (db->count);
}

int	save_users_to_file(const t_database *db, const char *filename)
{
	FILE	*f;
	int		i;

	f = fopen(filename, "w");
	if (!f)
	{
		return (-1);
	}
	{
		i = 0;
		while (i < db->count)
		{
			fprintf(f, "%s %d %f\n", db->users[i].name, db->users[i].age, db->users[i].score);
			i++;
		}
	}
	fclose(f);
	return (0);
}

int	sum_array(int *arr, int size)
{
	int	sum;
	int	i;

	sum = 0;
	{
		i = 0;
		while (i < size)
		{
			sum += arr[i];
			i++;
		}
	}
	return (sum);
}

double	average_array(int *arr, int size)
{
	if (size == 0)
	{
		return (0);
	}
	return ((double) sum_array(arr, size) / size);
}

void	bubble_sort(int *arr, int size)
{
	int	i;
	int	j;
	int	tmp;

	{
		i = 0;
		while (i < size - 1)
		{
			{
				j = 0;
				while (j < size - i - 1)
				{
					if (arr[j] > arr[j + 1])
					{
						tmp = arr[j];
						arr[j] = arr[j + 1];
						arr[j + 1] = tmp;
					}
					j++;
				}
			}
			i++;
		}
	}
}

void	reverse_string(char *str)
{
	int		len;
	int		i;
	char	t;

	if (!str)
	{
		return ;
	}
	len = strlen(str);
	{
		i = 0;
		while (i < len / 2)
		{
			t = str[i];
			str[i] = str[len - i - 1];
			str[len - i - 1] = t;
			i++;
		}
	}
}

int	main(void)
{
	t_database	db;
	int			arr[10];
	int			i;
	char		text[BUFFER_SIZE];

	init_database(&db);
	add_user(&db, "alice", 20, 88.5);
	add_user(&db, "bob", 22, 91.2);
	add_user(&db, "charlie", 19, 72.4);
	print_database(&db);
	update_score(&db, 2, 95.0);
	printf("After update:\n");
	print_database(&db);
	arr[0] = 5;
	arr[1] = 3;
	arr[2] = 8;
	arr[3] = 1;
	arr[4] = 2;
	arr[5] = 9;
	arr[6] = 4;
	arr[7] = 7;
	arr[8] = 6;
	arr[9] = 0;
	bubble_sort(arr, 10);
	{
		i = 0;
		while (i < 10)
		{
			printf("%d ", arr[i]);
			i++;
		}
	}
	printf("\n");
	text[0] = 102;
	text[1] = 111;
	text[2] = 114;
	text[3] = 109;
	text[4] = 97;
	text[5] = 116;
	text[6] = 116;
	text[7] = 101;
	text[8] = 114;
	text[9] = 95;
	text[10] = 116;
	text[11] = 101;
	text[12] = 115;
	text[13] = 116;
	text[14] = 95;
	text[15] = 115;
	text[16] = 116;
	text[17] = 114;
	text[18] = 105;
	text[19] = 110;
	text[20] = 103;
	text[21] = 0;
	reverse_string(text);
	printf("%s\n", text);
	return (0);
}
