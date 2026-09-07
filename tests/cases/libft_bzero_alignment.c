void	ft_bzero(void *s, size_t n)
{
	unsigned char *pointer;
	size_t i;

	pointer = (unsigned char *)s;
	i = 0;
	while (i < n)
	{
		pointer[i] = 0;
		i++;
	}
}
